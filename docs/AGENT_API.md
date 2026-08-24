# TaskForge Agent API

This guide documents the current HTTP API for people and software agents. The examples assume the API is running at `http://127.0.0.1:4000`.

All protected endpoints require:

```http
Authorization: Bearer <JWT-or-agent-token>
```

Agent tokens are opaque, revocable bearer credentials. They are shown only once when issued. Never commit a token or place it in task text.

## Authentication and project access

Humans sign in to receive a short-lived JWT:

```bash
JWT=$(curl -sS http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@taskforge.local","password":"demo1234"}' | jq -r .token)
```

Administrators create an agent identity and issue its token:

```bash
AGENT_ID=$(curl -sS http://127.0.0.1:4000/api/users/agents \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"name":"Repository Builder","email":"builder@example.local"}' | jq -r .user.id)

AGENT_TOKEN=$(curl -sS "http://127.0.0.1:4000/api/users/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"name":"Local Codex token","expiresInDays":90}' | jq -r .token)
```

Add the agent to every project it should access:

```bash
PROJECT_ID=$(curl -sS http://127.0.0.1:4000/api/projects \
  -H "Authorization: Bearer $JWT" | jq -r '.projects[0].id')

curl -sS -X POST "http://127.0.0.1:4000/api/projects/$PROJECT_ID/members" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$AGENT_ID\",\"role\":\"MEMBER\"}"
```

Membership is the authorization boundary. Administrators can access all projects; other users and agents must be members. A project owner or administrator manages membership, phases, and automations.

## Shareable project/task context

People can share readable URLs such as:

```text
http://127.0.0.1:5173/?project=TAS&task=TAS-4
```

Agents can resolve the same context without knowing internal UUIDs:

```bash
curl -sS "http://127.0.0.1:4000/api/context?project=TAS&task=TAS-4" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

`project` accepts a project key or UUID. `task` accepts a readable key such as `TAS-4` or a task UUID. When a task is resolved, `task.updates` contains the first page of notes newest-first with each note's `author` hydrated. `task.updatesPage` has the same continuation shape as the notes endpoint; follow it with `GET /api/tasks/:id/updates` when `hasMore` is true.

## Pagination

Project task lists, search, task updates, notifications, and activity are bounded cursor-paginated endpoints. They keep their existing first-page array fields (`tasks`, `results`, `updates`, `notifications`, or `activity`) and add:

```json
{"page":{"limit":50,"hasMore":true,"nextCursor":"opaque-value"}}
```

Pass `limit` (1–100, default 50; activity retains its existing maximum of 200) and the returned opaque `cursor` to request the next page. Do not parse or modify cursors. A final page has `hasMore: false` and `nextCursor: null`. Results use deterministic keyset ordering with an ID tie-breaker, so equal timestamps do not duplicate or disappear at a page boundary. Filters and authorization are applied before the page limit. Notification `unreadCount` is the total unread count for the current user, not just the current page.

## Projects

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
PATCH  /api/projects/order
```

Create a project with `key`, `name`, `description`, optional `repoUrl`, and `color`:

```bash
curl -sS -X POST http://127.0.0.1:4000/api/projects \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"WEB","name":"Website","description":"Public site","repoUrl":"https://github.com/acme/site","color":"#6554C0"}'
```

Project keys are case-insensitive and unique. A duplicate returns `409` with a message such as `Project key WEB is already in use`. Updateable fields are `name`, `description`, `repoUrl` (or `null` to remove it), `color`, `availableStatuses`, and `defaultStatus`; the key cannot be changed. `defaultStatus` must be included in the non-empty `availableStatuses` array. A status cannot be disabled while tasks or automations still use it.

The project list is ordered by persisted sidebar order. New projects are inserted first. To persist a drag-and-drop order, send every accessible project ID exactly once:

```bash
curl -sS -X PATCH http://127.0.0.1:4000/api/projects/order \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"projectIds":["newest-project-uuid","older-project-uuid"]}'
```

Project membership:

```http
POST   /api/projects/:id/members        {"userId":"...","role":"MEMBER"}
DELETE /api/projects/:id/members/:userId
```

## Tasks

```http
GET    /api/projects/:projectId/tasks
POST   /api/projects/:projectId/tasks
POST   /api/projects/:projectId/tasks/claim
GET    /api/tasks/:id
PATCH  /api/tasks/:id
POST   /api/tasks/:id/dependencies
DELETE /api/tasks/:id
```

Task creation and update fields include:

| Field | Values/notes |
| --- | --- |
| `title` | Required string |
| `description`, `definitionOfDone` | Optional text |
| `status` | `BACKLOG`, `REFINING`, `TODO`, `READY_FOR_DEV`, `IN_PROGRESS`, `READY_FOR_REVIEW`, `IN_REVIEW`, `DONE`, `CANCELLED`, `APPROVED`, `RE_REVIEW`, `FIX_NEEDED`, `PENDING_DECISION`, `FAILED`; must be enabled for the project. If omitted during creation, the project's `defaultStatus` is used. New orchestration statuses are opt-in and are not enabled on existing or new projects by default. |
| `priority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `type` | `FEATURE`, `BUG`, `INFRA`, `UPDATE`, `SECURITY`, `DOCS`, `CHORE` |
| `assigneeId` | Project-member UUID or `null` |
| `parentId` | Same-project task UUID; cycles are rejected |
| `branch` | Nullable branch string |
| `dueDate` | Nullable ISO date |
| `estimatePoints` | Nullable integer from 0 to 100 |
| `phaseId` | Same-project phase UUID; omitted creation defaults to the active phase |
| `pullRequestUrl`, `pullRequestTitle` | Nullable PR metadata |
| `pullRequestState` | `DRAFT`, `OPEN`, `MERGED`, `CLOSED` |
| `tags` | Array of reusable tag names |
| `dependencyIds` | Same-project task UUIDs; self/cyclic dependencies are rejected |

Example:

```bash
curl -sS -X POST "http://127.0.0.1:4000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title":"Add retry logic",
    "description":"Retry transient upstream failures.",
    "definitionOfDone":"Tests cover 429 and 503 responses.",
    "status":"IN_PROGRESS",
    "priority":"HIGH",
    "type":"INFRA",
    "branch":"agent/retry-logic",
    "pullRequestState":"OPEN",
    "estimatePoints":3,
    "tags":["backend","reliability"],
    "dependencyIds":["dependency-task-uuid"]
  }'
```

List filters are query parameters: `status`, `assigneeId`, `priority`, `type`, `phaseId`, `tag`, `minPoints`, `maxPoints`, and `q` (searches title/description), plus the shared `limit` and `cursor` pagination parameters. Task responses include `phaseId` plus a `phase` object (`id`, `number`, `goal`, and `isActive`), as well as `tags`, `dependencies` (with `isBlocking`), `attachments`, and the hydrated `assignee`.

### Project workflow and task claiming

`project.availableStatuses` is authoritative for agents. Read it from `GET /api/context` before every status transition and never send a disabled status. `project.defaultStatus` is only the default for task creation; it does not identify a work, review, or completion transition.

Claiming uses this fixed semantic mapping:

- Enabled `BACKLOG`, `TODO`, and `READY_FOR_DEV` statuses are eligible claim sources.
- `IN_PROGRESS` is the claim target and must be enabled.
- At least one claim source must be enabled. A project without `IN_PROGRESS`, or without any enabled claim source, returns `400` with instructions to update project settings.
- The winning task is selected by priority and position. Assignment, source-status eligibility, and the move to `IN_PROGRESS` are repeated in one conditional update, so concurrent callers cannot both claim the same task.
- Pass the optional `runId` (UUID) when a runner claims work. It is carried into the resulting `task.status_changed` event so callbacks can be correlated to the durable run.

Claim the next available task, optionally filtering by `phaseId` or `priority`:

```bash
curl -sS -X POST "http://127.0.0.1:4000/api/projects/$PROJECT_ID/tasks/claim" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"priority":"HIGH"}'
```

For handoff and lifecycle updates, use `READY_FOR_REVIEW` when enabled, otherwise `IN_REVIEW` when enabled. Use `DONE` for successful completion only when it is enabled; `CANCELLED` is not a completion substitute. If the project has no enabled review or completion status, refresh `GET /api/context`, leave the task status unchanged, and ask the project owner which enabled transition represents that step. Send-to-AI prompts follow these same rules and list the enabled statuses they were generated from.

To replace dependencies without changing any other task fields, use the dedicated endpoint. The request replaces the full set atomically at the application level; send an empty array to remove all dependencies:

```bash
curl -sS -X POST "http://127.0.0.1:4000/api/tasks/$TASK_ID/dependencies" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"dependencyIds":["dependency-task-uuid"]}'
```

Each returned dependency includes its task key (`projectKey` plus `number`), title, current status, and `isBlocking` (`false` once the dependency reaches `DONE` or `CANCELLED`). Self-dependencies, cross-project dependencies, and cycles return validation errors.

## Notes, dependencies, tags, and attachments

Task notes/updates:

```http
GET  /api/tasks/:id/updates
POST /api/tasks/:id/updates   {"body":"Implementation is ready for review."}
```

Reusable project tags:

```http
GET /api/projects/:projectId/tags
```

Attachments use base64 payloads and support PDFs, documents, images, and other validated MIME types:

```http
GET    /api/tasks/:id/attachments
POST   /api/tasks/:id/attachments
GET    /api/attachments/:id/download
DELETE /api/attachments/:id
```

Upload body:

```json
{"fileName":"design.pdf","mimeType":"application/pdf","data":"<base64>"}
```

Dependencies are managed through the task `dependencyIds` array on create/update. The API rejects cross-project, self, and cyclic relationships. Dependency responses include the dependency task key/number, title, status, and whether it is blocking.

## Phases

```http
GET    /api/projects/:projectId/phases
POST   /api/projects/:projectId/phases
PATCH  /api/phases/:id
DELETE /api/phases/:id
```

Phase creation accepts `{ "number": 2, "goal": "Ship the API", "isActive": true }`. Phase numbers are unique within a project and only one phase can be active. New tasks without an explicit `phaseId` are assigned to the active phase. Deleting an active phase promotes the highest-numbered remaining phase; deleting the final phase leaves tasks unassigned. The board defaults to the active phase; a selected phase can be shared through the web URL's `phase` query parameter.

## Automations

Project owners/admins manage generic task rules:

```http
GET    /api/projects/:projectId/automations
POST   /api/projects/:projectId/automations
PATCH  /api/automations/:id
DELETE /api/automations/:id
```

An automation has a `name`, `enabled` flag, `trigger` (`TASK_CREATED` or `TASK_UPDATED`), optional actor filter (`ANY`, `USER`, or `SERVICE`), `conditions`, and `actions`.

Supported condition/action fields are `status`, `priority`, `type`, `assigneeId`, `pullRequestState`, `phaseId`, `branch`, and `estimatePoints`. Condition operators are `equals`, `not_equals`, `changed_to`, `is_empty`, and `is_not_empty`. Action value types are `static`, `actor` (the user who triggered the task change), `user`, `service`, and `null`.

Example: assign a task to the changer when it enters progress and has no assignee:

```json
{
  "name":"Assign task to changer",
  "trigger":"TASK_UPDATED",
  "conditions":[
    {"field":"status","operator":"changed_to","value":"IN_PROGRESS"},
    {"field":"assigneeId","operator":"is_empty","value":null}
  ],
  "actions":[{"field":"assigneeId","valueType":"actor","value":null}]
}
```

Rules execute as part of task create/update and can update any supported task field.

## Signed agent webhooks

Administrators configure an agent receiver and inspect its delivery queue through:

```http
PATCH /api/users/:agentId/webhook                    {"webhookUrl":"https://agent.example/webhook"}
POST  /api/users/:agentId/webhook-secret/rotate
GET   /api/users/webhook-deliveries?agentId=:agentId&status=FAILED&limit=50
POST  /api/users/webhook-deliveries/:deliveryId/retry
```

The first non-null webhook URL creates a per-agent signing secret. The response includes `webhookSecret` once; later URL changes do not reveal it. Rotation returns a new secret once and increments `X-TaskForge-Secret-Version`. Update the receiver immediately after rotation because pending and future attempts use the agent's current secret. Webhook URLs must use HTTP or HTTPS and cannot contain username/password credentials.

TaskForge durably stores `task.assigned`, `task.update_added`, and `task.status_changed` events in the same transaction as the task change, then dispatches only after commit. Status changes from task claiming include `previousStatus`; a direct status update made by the assigned agent does not enqueue an event back to that agent. A request body has a stable event envelope such as:

```json
{
  "id": "0c533272-7c46-4f0c-9587-d89065ef0b67",
  "event": "task.update_added",
  "task": { "id": "...", "projectKey": "TAS", "number": 51 },
  "update": { "id": "...", "body": "Please retry this delivery." },
  "postedBy": { "id": "...", "name": "Project owner" },
  "timestamp": "2026-08-23T10:00:00.000Z"
}
```

A status-change envelope includes `previousStatus`, `changedBy`, and the resolved task status:

```json
{
  "id": "...",
  "event": "task.status_changed",
  "task": { "id": "...", "projectKey": "TAS", "number": 51, "status": "IN_PROGRESS", "assigneeId": "..." },
  "previousStatus": "READY_FOR_DEV",
  "changedBy": { "id": "...", "name": "Project owner" },
  "timestamp": "2026-08-23T10:00:00.000Z"
}
```

Each request includes:

```http
Idempotency-Key: <event-id>
X-TaskForge-Event-Id: <event-id>
X-TaskForge-Delivery-Attempt: 1
X-TaskForge-Secret-Version: 2
X-TaskForge-Signature: t=<unix-seconds>,v1=<hex-hmac>
```

## PR gates and merge authorization

Gate evidence is bound to the exact commit SHA of the pull request head:

```http
GET /api/tasks/:taskId/gate
PUT /api/tasks/:taskId/gate
POST /api/tasks/:taskId/gate/approve
POST /api/tasks/:taskId/gate/merge
```

Record `{ "headSha": "<sha>", "requiredChecks": ["Quality", "API on MySQL 8"], "checks": [{"name":"Quality","status":"PASS","headSha":"<sha>"}] }`. A new head SHA clears prior approval and merge evidence. Every required check must be `PASS` for the same SHA. Only an agent identity named Codex can approve; only the project owner or an administrator can authorize a merge. Merge authorization updates the task to `MERGED` and records an activity audit entry. TaskForge never merges a remote provider PR itself; the gate is the authorization and evidence boundary.

## Autonomous runs and leases

TaskForge stores orchestration bookkeeping but never starts a provider process. A runner creates and owns a run through these endpoints:

```http
GET  /api/tasks/:taskId/runs
POST /api/tasks/:taskId/runs        { "kind": "IMPLEMENTATION|REVIEW|RE_REVIEW|FIX", "maxAttempts": 3, "timeoutAt": "..." }
POST /api/runs/:id/claim           { "leaseMs": 60000 }
POST /api/runs/:id/heartbeat       { "leaseMs": 60000 }
POST /api/runs/:id/complete        { "status": "SUCCEEDED|FAILED|CANCELLED", "error": "..." }
```

Claims are atomic and leases are exclusive. Heartbeats and successful/failed completion require the lease owner; owner/admin cancellation is lease-independent so operators can stop an abandoned run. A background expiry sweep runs every 30 seconds in the API, and every run operation also reaps expired pending or running leases/timeouts; these become retryable `FAILED` runs subject to the per-run attempt budget and a task-level delivery-cycle cap. When changing a task status for a run, include its `runId` in the task PATCH; the resulting `task.status_changed` webhook carries that ID. A runner must persist run IDs and treat callbacks as idempotent.

Verify `v1` with HMAC-SHA256 over the exact raw body, prefixed by the timestamp and a period: `HMAC(secret, timestamp + "." + rawBody)`. Compare digests in constant time and reject timestamps outside a short tolerance such as five minutes:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, signatureHeader, rawBody, nowSeconds = Date.now() / 1000) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signatureHeader ?? "");
  if (!match || Math.abs(nowSeconds - Number(match[1])) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.${rawBody}`).digest();
  const supplied = Buffer.from(match[2], "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
```

Delivery is at least once. Store each successfully processed `id` (the same value as both event-ID headers) and return a 2xx response for duplicates without repeating side effects. TaskForge treats timeouts, network failures, and every non-2xx response as failures. It attempts delivery at most five times, with delays of 1, 2, 4, and 8 seconds, then marks the event `FAILED`; an administrator can manually queue a terminal failure with a fresh five-attempt budget. Operator responses and delivery logs contain status metadata but never the signing secret, destination URL, or stored payload.

## Users, agents, tokens, notifications, and search

```http
GET    /api/users
PATCH  /api/users/me
POST   /api/users/:id/avatar       {"mimeType":"image/png","data":"<base64>"}
DELETE /api/users/:id/avatar
POST   /api/users/agents           (administrator)
DELETE /api/users/:id              (administrator)
POST   /api/users/:id/tokens       (administrator or token owner)
GET    /api/users/:id/tokens
DELETE /api/users/tokens/:id
PATCH  /api/users/:id/webhook
POST   /api/users/:id/webhook-secret/rotate
GET    /api/users/webhook-deliveries
POST   /api/users/webhook-deliveries/:deliveryId/retry
GET    /api/notifications
PATCH  /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/search?q=retry
GET    /api/activity?projectId=...&limit=50
```

Agent token metadata can be listed, but the secret itself is never returned after issuance. Profile pictures accept PNG, JPEG, GIF, or WebP data URLs and are visible on assignees and task updates.

## Errors

Errors include an `error` string. Validation errors additionally include structured `issues`:

```json
{"error":"Validation failed","issues":[{"path":["title"],"message":"String must contain at least 1 character(s)"}]}
```

Use `401` for missing/expired credentials, `403` for project authorization failures, `404` for missing resources, `409` for conflicts such as duplicate project keys, and `400` for invalid input or task relationships.
