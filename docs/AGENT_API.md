# Agent API guide

Agents use revocable bearer tokens. The token is shown once when issued, stored only as a SHA-256 hash, and can be revoked without changing the agent identity or other credentials.

The examples assume the API runs at `http://127.0.0.1:4000`.

## Resolve a link shared by a person

TaskForge URLs carry readable context, for example:

```text
http://127.0.0.1:5173/?project=TF&task=TF-4
```

An agent can pass the same query parameters to the API instead of resolving internal UUIDs itself:

```bash
curl -sS "$TASKFORGE_URL/api/context?project=TF&task=TF-4" \
  -H "Authorization: Bearer $TASKFORGE_TOKEN"
```

The response contains the project and complete task, including assignment, definition of done, branch, and pull-request metadata. `project` accepts a project key or UUID; `task` accepts a readable task key or UUID.

## 1. Create an agent and issue a token

An administrator first signs in as a human:

```bash
JWT=$(curl -sS http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@taskforge.local","password":"demo1234"}' \
  | jq -r .token)
```

Create a stable identity for the automation:

```bash
AGENT_ID=$(curl -sS http://127.0.0.1:4000/api/users/agents \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Repository Builder","email":"builder@example.local"}' \
  | jq -r .user.id)
```

Issue a token. `expiresInDays` may be `null` for a non-expiring credential, although rotation with an expiration is recommended.

```bash
AGENT_TOKEN=$(curl -sS "http://127.0.0.1:4000/api/users/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local Codex token","expiresInDays":90}' \
  | jq -r .token)
```

Store `AGENT_TOKEN` in a secret manager or environment variable. It cannot be retrieved again.

## 2. Add the agent to a project

Get a project ID and add the identity as a member:

```bash
PROJECT_ID=$(curl -sS http://127.0.0.1:4000/api/projects \
  -H "Authorization: Bearer $JWT" | jq -r '.projects[0].id')

curl -sS -X POST "http://127.0.0.1:4000/api/projects/$PROJECT_ID/members" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$AGENT_ID\",\"role\":\"MEMBER\"}"
```

Project membership is the authorization boundary. A non-admin identity cannot list or mutate projects it has not joined.

## 3. Read and update tasks

List accessible projects and tasks:

```bash
curl -sS http://127.0.0.1:4000/api/projects \
  -H "Authorization: Bearer $AGENT_TOKEN"

curl -sS "http://127.0.0.1:4000/api/projects/$PROJECT_ID/tasks?status=TODO" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

Read the project's phases to identify the active planning window:

```bash
curl -sS "http://127.0.0.1:4000/api/projects/$PROJECT_ID/phases" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

The task list also supports `assigneeId`, `priority`, `phaseId`, `minPoints`, `maxPoints`, and `q` query parameters. New tasks default to the project's active phase when `phaseId` is omitted.

Create a task:

```bash
curl -sS "http://127.0.0.1:4000/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Add retry logic",
    "description":"Retry transient upstream failures with bounded backoff.",
    "definitionOfDone":"Integration tests cover 429 and 503 responses.",
    "status":"IN_PROGRESS",
    "priority":"HIGH",
    "branch":"agent/retry-logic",
    "pullRequestUrl":"https://github.com/example/repo/pull/17",
    "pullRequestTitle":"Add bounded retry logic",
    "pullRequestState":"OPEN",
    "estimatePoints":3
  }'
```

Update only the fields that changed:

```bash
curl -sS -X PATCH "http://127.0.0.1:4000/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"IN_REVIEW"}'
```

Statuses are `BACKLOG`, `TODO`, `IN_PROGRESS`, `IN_REVIEW`, and `DONE`. Priorities are `LOW`, `MEDIUM`, `HIGH`, and `URGENT`.

To create a subtask, pass the parent task's UUID as `parentId`. The API rejects cross-project parents and cycles.

Post a progress update that will appear in the task timeline:

```bash
curl -sS "http://127.0.0.1:4000/api/tasks/$TASK_ID/updates" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Implementation is complete and PR #17 is ready for review."}'
```

Read the timeline with `GET /api/tasks/:id/updates`. Pull request states are `DRAFT`, `OPEN`, `MERGED`, and `CLOSED`.

## 4. Revoke a token

List token metadata (never the secret itself), then revoke by token ID:

```bash
curl -sS "http://127.0.0.1:4000/api/users/$AGENT_ID/tokens" \
  -H "Authorization: Bearer $JWT"

curl -sS -X DELETE "http://127.0.0.1:4000/api/users/tokens/$TOKEN_ID" \
  -H "Authorization: Bearer $JWT"
```

The next request made with the revoked token receives HTTP `401`.

## Error contract

Errors always include an `error` string. Validation failures also contain structured Zod `issues`:

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": ["title"], "message": "String must contain at least 1 character(s)" }
  ]
}
```

Use `401` to refresh or replace credentials, `403` for missing project membership, `404` for absent resources, `409` for unique-key conflicts, and `400` for invalid input or relationships.
