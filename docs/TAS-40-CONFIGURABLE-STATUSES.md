# TAS-40: Configurable task workflows

Status: proposed

## Decision

Replace the five-value task status enum with persisted workflow status records. TaskForge will keep one administrator-managed default workflow template and copy that template into every new project. Each project owns its copied workflow, so later edits to the default affect future projects only and cannot silently change an existing board.

Each status has a stable ID and key, an editable label and color, an explicit order, and semantic metadata. Product behavior must use the semantic metadata or stable ID instead of comparing the display label or legacy key.

The initial default remains:

| Key | Label | Category | Behavior |
| --- | --- | --- | --- |
| `BACKLOG` | Backlog | `NOT_STARTED` | Claimable |
| `TODO` | To do | `NOT_STARTED` | Initial status for new tasks; claimable |
| `IN_PROGRESS` | In progress | `ACTIVE` | Claim target; included in stuck-work detection |
| `IN_REVIEW` | In review | `ACTIVE` | Triggers review notification; excluded from stuck-work detection |
| `DONE` | Done | `COMPLETED` | Satisfies dependencies |

This gives users custom columns and labels while preserving the meaning needed by claiming, dependency resolution, notifications, dashboards, and agents.

## Why the enum cannot simply become a string

A free-form string would remove validation but leave the rest of the system guessing. Today the status values also encode behavior:

- `TODO` is the create default.
- `BACKLOG` and `TODO` are claim candidates; claiming moves a task to `IN_PROGRESS`.
- entering `IN_REVIEW` creates a review notification.
- `DONE` unblocks dependent tasks.
- dashboard progress, open work, and stuck work compare fixed values.
- board columns, filters, automation controls, agent prompts, webhook payloads, fixtures, and documentation assume the same five values.

Display names are user content and can change. They are therefore unsuitable identifiers for tasks, automations, or behavior.

## Current implementation inventory

| Area | Current coupling |
| --- | --- |
| Shared contracts | `packages/contracts/src/index.ts` defines `taskStatusSchema` as a Zod enum, defaults creation to `TODO`, and exposes `TaskStatus` throughout the client and server. |
| Persistence | `apps/api/src/db/database.ts` has five-value `CHECK` constraints and a `TODO` default in both SQLite and MySQL schemas. |
| Task repository | `apps/api/src/infrastructure/repositories.ts` groups position by the status string and hard-codes claim source and target values. |
| Task service | `apps/api/src/application/task-service.ts` defaults creation, emits review notifications, and resolves dependencies from fixed values. |
| Responses | `apps/api/src/lib/rows.ts` and `apps/api/src/lib/task-response.ts` calculate dependency blocking from `DONE`. |
| Reporting | `apps/api/src/routes/dashboard.ts` returns five named counters and uses fixed definitions for open and stuck tasks. |
| Agents | agent-ops queries, the Send to AI prompt, context, webhooks, and `docs/AGENT_API.md` expose or prescribe legacy values. |
| Automations | status conditions/actions store strings, while `apps/web/src/components/AutomationManager.tsx` offers a fixed list. |
| Web UI | `apps/web/src/lib/ui.ts`, board/list/task controls, filters, dependency displays, and dashboard widgets use fixed metadata and comparisons. |
| Tests and seeds | API/web tests, mocks, and seed data construct tasks with legacy values. |

## Options considered

### Keep the enum and make labels configurable

This is low risk but does not support a custom selection or additional columns. It also keeps product behavior coupled to five internal names.

### Store arbitrary status strings on tasks

This supports custom columns quickly but makes renames destructive, allows invalid values, breaks stable automation references, and cannot reliably express completion, claiming, or review behavior.

### Use project status records only

This provides customization but does not answer how administrators configure the initial workflow for new projects. It would also duplicate the seed definition in application code.

### Default template plus project-owned copies (recommended)

This meets both requested configuration levels. Stable IDs make renames safe, and semantic metadata preserves behavior without reserving labels. Copy-on-project-create avoids surprising propagation from global edits.

## Proposed domain model

Use two related resources rather than sharing mutable status rows between templates and projects:

```text
workflow_templates
  id, name, is_system_default, created_at, updated_at

workflow_template_statuses
  id, template_id, key, label, color, category, position,
  is_initial, is_claimable, is_claim_target, triggers_review,
  tracks_staleness, satisfies_dependencies, archived_at

project_statuses
  id, project_id, key, label, color, category, position,
  is_initial, is_claimable, is_claim_target, triggers_review,
  tracks_staleness, satisfies_dependencies, archived_at,
  created_at, updated_at

tasks
  ... status_id -> project_statuses.id ...
```

`category` is a small system enum: `NOT_STARTED`, `ACTIVE`, or `COMPLETED`. These deliberately differ from the legacy status keys so API consumers do not confuse a user-configurable status with its broad lifecycle category. Categories exist for aggregation and open/completed lifecycle behavior, not presentation. Multiple project statuses may share a category; for example, "Development" and "QA" can both be `ACTIVE`.

The key is an immutable uppercase slug of 1-32 characters matching `^[A-Z][A-Z0-9_]{0,31}$`, unique case-insensitively within its template or project. When a create request omits it, the server derives it once from the label: Unicode-normalize with NFKD, remove combining marks, uppercase, replace runs outside `A-Z0-9` with `_`, trim underscores, use `STATUS` if empty, prefix `S_` if the result starts with a digit, and truncate to 32 characters. A collision appends `_2`, `_3`, and so on while truncating the base to retain the 32-character limit. An explicitly supplied invalid key returns `400`; an explicit collision returns `409`. Renaming the label never changes the key. Tasks and automations persist IDs, never labels. Behavior flags are intentionally independent of category: for example, both Backlog and Icebox may be `NOT_STARTED`, while only Backlog is `is_claimable`.

Phase 2 stores a single template row whose `is_system_default` is true and exposes only that resource. The table shape leaves room for named templates later, but creating, selecting, or applying additional templates is explicitly future scope.

### Required invariants

- Exactly one template is `is_system_default`.
- Each template or project workflow has exactly one non-archived `is_initial` status for new tasks, and it belongs to `NOT_STARTED`.
- Each workflow has at least one non-archived claimable status, and every claimable status belongs to `NOT_STARTED`.
- Each workflow has exactly one non-archived claim target, and it belongs to `ACTIVE`.
- Each workflow retains at least one non-archived `NOT_STARTED`, `ACTIVE`, and `COMPLETED` status.
- At least one non-archived `COMPLETED` status satisfies dependencies; only `COMPLETED` statuses may do so.
- Only `ACTIVE` statuses may trigger review notifications or participate in stuck-work tracking.
- A task can reference only a status owned by its project.
- Status `position` is unique within its template or project and is normalized to a dense zero-based sequence after every reorder.
- Archived statuses cannot receive new tasks and are omitted from new-task controls.
- Archiving a status that has tasks requires an explicit replacement status; the move and archive occur in one transaction.
- A status referenced by an automation requires a replacement or disabling that automation before archive.
- Editing the default template affects only projects created afterward. Applying it to an existing project is a separate, explicit future operation.

Database constraints should enforce ownership and uniqueness where practical; the application service must validate the full invariant set transactionally for both supported databases.

## API shape

Workflow updates should be atomic snapshots, because several independent create/update/delete calls can temporarily leave a workflow with no default or completion status.

```http
GET /api/settings/default-workflow
PUT /api/settings/default-workflow

GET /api/projects/:projectId/workflow
PUT /api/projects/:projectId/workflow
```

The global endpoints are administrator-only. Project reads require membership; project writes require the project owner or an administrator. A `PUT` sends the ordered statuses plus replacement mappings for removed or archived IDs. Existing IDs are preserved, while omitted/new IDs are validated as archive/create operations.

Task contracts should move to `statusId` as the canonical input and return the resolved status definition:

```json
{
  "statusId": "project-status-uuid",
  "statusDefinition": {
    "id": "project-status-uuid",
    "key": "QA",
    "label": "Quality assurance",
    "color": "#6554C0",
    "category": "ACTIVE",
    "position": 3,
    "isInitial": false,
    "isClaimable": false,
    "isClaimTarget": false,
    "triggersReview": true,
    "tracksStaleness": false,
    "satisfiesDependencies": false
  }
}
```

During migration, create/update/filter endpoints may also accept the legacy `status` key and map it to a non-archived key within the task's project. If both are supplied they must resolve to the same status. A missing or archived key returns `400` with a stable `UNKNOWN_STATUS_KEY` code and directs the caller to `GET /api/projects/:projectId/workflow`; filters must not silently return an empty result. Responses retain `status` as a deprecated stable key until all first-party clients and documented consumers have moved to `statusId`; they must also expose `statusDefinition` so custom labels are never lost. This key is stable but no longer enum-valued: from TAS-43 onward a customized workflow may return values such as `QA`, so consumers must tolerate unknown keys and discover the project workflow instead of switch-casing only the legacy five.

From the TAS-43 cutover through TAS-46, `status_id` is the only read source of truth, but task creation and transitions transactionally dual-write the legacy `tasks.status` column with the resolved status's immutable key. The deprecated response `status` is always derived from `statusDefinition.key`, never read from the compatibility column. The column is widened to 32 characters and retained only as a recovery/audit copy during the compatibility window; it does not make TAS-43's schema backward-compatible with TAS-42 code. Rolling application code back past the step-6 cutover requires a matching schema down-migration because TAS-42 does not populate the now-required `status_id`. TAS-46 removes the copy after legacy clients are retired.

Context responses and webhook task payloads should use the same task representation. Automation status conditions and actions must store status IDs and render the current label. Dashboard responses should return `countsByStatus` for columns and `countsByCategory` for portable progress metrics instead of five named fields.

## Behavior mapping

| Capability | New rule |
| --- | --- |
| Create task | Use the project's `is_initial` status when `statusId` is omitted. |
| Claim task | Candidates are unassigned tasks whose status has `is_claimable`; move the winner to `is_claim_target`. Candidate selection may precede the write, but the atomic conditional `UPDATE` must repeat both `assignee_id IS NULL` and claimable-status eligibility so two claimers cannot win. |
| Review notification | Emit only on a false-to-true edge when the actor is not the task creator: the new status has `triggers_review`, the previous status did not, and `creator_id != actor_id`. Moving between two review-triggering statuses or a creator moving their own task does not notify. |
| Dependencies | A dependency stops blocking only in a status with `satisfies_dependencies` true. |
| Task list and board ordering | Join `project_statuses` and order by its `position`, then the task's status-scoped `position`; never order by the status key or UUID. |
| Project open work | Any status whose category is not `COMPLETED`. |
| My tasks | Preserve the current default of assigned `TODO`, `IN_PROGRESS`, and `IN_REVIEW` tasks by selecting assigned statuses that are `ACTIVE` or `is_initial`; other `NOT_STARTED` columns such as Backlog or Icebox remain out of this feed. |
| Agent workload | Agent-ops open counts include assigned tasks in the `ACTIVE` category across projects. |
| Progress | Aggregate category `COMPLETED` versus total; report individual status counts separately. |
| Stuck work | Tasks whose status has `tracks_staleness` and whose age exceeds the existing four-hour threshold. The legacy mapping enables it for `IN_PROGRESS` and disables it for `IN_REVIEW`, preserving today's behavior. Agent-ops uses the same flag across projects. |
| Agent instructions | Discover the project workflow and use status IDs/keys advertised by the API. |

The workflow editors must explain that `is_initial` has two intentional Phase 2 effects: it selects the status assigned to newly created tasks and includes assigned tasks in the My Tasks feed. Changing the initial status therefore changes feed membership as well as task-creation defaults.

## Migration and compatibility plan

1. Introduce versioned migrations rather than adding another one-off column probe to `database.ts`.
2. Create the default template and status tables, seeding the five legacy definitions.
3. Copy those definitions to every existing project with deterministic legacy-key mapping.
4. In TAS-42, add nullable `tasks.status_id` and backfill current rows from `(project_id, legacy status)`. Leave the legacy `status` column, its five-value constraint, and all existing repositories/services untouched, because tasks created between the TAS-42 and TAS-43 deployments will legitimately have a null `status_id`.
5. In TAS-43 startup migration, rerun the idempotent backfill to cover rows created after TAS-42, verify that no row remains unmapped, then switch repositories and services to `status_id`, add resolved status data to responses, and temporarily support legacy keys at the HTTP boundary. If validation fails, emit structured diagnostics containing every offending task ID and its missing `(project_id, legacy key)` mapping before aborting; do not report only a count. Task list queries join status definitions for ordering, claim keeps its eligibility check inside the conditional update, and writes begin transactionally updating both canonical `status_id` and the legacy key column.
6. Still in TAS-43, after the final backfill and code cutover are ready, rebuild the SQLite `tasks` table and alter the MySQL table to remove the old five-value constraint, make `status_id` non-null, widen the dual-written legacy key column to 32 characters, and add the same-project foreign key/indexes. Exercise fresh install, direct upgrade, and the intermediate TAS-42-deployed state in tests. Document and test that rolling back to TAS-42 code after this point requires a schema down-migration.
7. Migrate automation status values to IDs. Invalid legacy values disable the affected rule with an actionable validation message rather than being guessed.
8. Move every first-party UI, dashboard, agent path, seed, and fixture to the workflow API.
9. After the compatibility window, TAS-46 removes the deprecated response/request key, enum, dual-write logic, and legacy database column.

The rollout should preserve task numbers, positions, timestamps, foreign keys, and all existing legacy labels. TAS-42 must remain deployable by itself: create, update, list, and claim continue using the legacy column until TAS-43. A TAS-43 migration must fail before destructive schema replacement if any task remains unmapped and emit the task IDs plus missing `(project_id, legacy key)` pairs described in step 5.

## Delivery tasks

The implementation is split along migration and client boundaries so each change remains reviewable:

1. **TAS-42 — Add configurable workflow status storage and migration.** Adds persistence with the 32-character key constraint, seeds the default records, copies them into new projects, and adds a nullable best-effort backfill without changing the legacy task read/write path or constraints. It does not add edit APIs. No dependencies.
2. **TAS-43 — Add workflow configuration and status-aware task APIs.** Reruns the diagnosable backfill, performs the repository/schema cutover, derives and validates stable keys, dual-writes the audit key, and adds administrator/project edit APIs, invariants, permissions, compatibility, atomic claiming, deterministic ordering, and edge-triggered review behavior with the existing self-notification guard. Depends on TAS-42.
3. **TAS-44 — Build global and per-project workflow editors.** Makes the web app and board dynamic, exposes status behavior controls in both configuration experiences, and explains `is_initial`'s task-creation and My Tasks effects. Depends on TAS-43.
4. **TAS-45 — Make dashboards, automations, and agent flows workflow-aware.** Migrates cross-cutting consumers and agent documentation, warns that deprecated keys may be custom rather than enum-valued, and preserves the current stuck-work default through `tracks_staleness`. Depends on TAS-43.
5. **TAS-46 — Retire legacy hard-coded task status compatibility.** Removes the enum, compatibility API, dual-write, and legacy column after first-party migration without dropping behavior guards. Depends on TAS-44 and TAS-45.

All five tasks are children of TAS-40 and are assigned to Phase 2.

## Testing strategy

- Migration tests start from legacy SQLite and MySQL schemas and from the intermediate TAS-42 schema, then assert row mappings, key constraints, useful unmapped-row diagnostics, recovery/audit dual-writes, the required schema down-migration boundary, and uninterrupted legacy task creation/claiming before TAS-43.
- Application tests cover workflow invariants, permissions, same-project validation, dense/unique ordering, archive-with-replacement, task creation defaults, canonical reads plus transactional legacy-key dual-writes, explicit claim eligibility, atomic claim races, false-to-true review transitions and the creator self-notification guard, staleness tracking, and dependency completion.
- Contract/API tests cover custom status IDs, legacy-key compatibility, filters, context, webhooks, and automation migration.
- Web tests use a workflow with more than five statuses and renamed labels to catch hidden constant usage.
- Dashboard tests use multiple statuses in the same semantic category.
- A repository-wide legacy-value search is part of TAS-46 acceptance.

## Explicit non-goals

This proposal does not add named/selectable workflow templates, an allowed-transition graph, per-role transition permissions, WIP limits, a configurable staleness duration, or automatic propagation of default-template edits to existing projects. Those capabilities can build on stable project status IDs later without changing this model.
