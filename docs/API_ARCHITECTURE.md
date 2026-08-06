# API architecture and refactor boundaries

This note describes the target shape for the Fastify API refactor. It is intentionally incremental: existing HTTP contracts and SQLite/MySQL behavior remain stable while responsibilities move behind explicit boundaries.

## Target request flow

```text
Fastify route (transport controller)
  -> request parsing + authentication context
  -> authorization policy
  -> application service / use case
  -> repository or adapter (SQL and driver differences)
  -> domain/API mapper (stable contracts)
  -> HTTP response
```

Controllers should not build SQL, decide transaction scope, coordinate notifications, or map database rows. Services own use-case orchestration and transaction intent. Repositories own persistence queries and return persistence records or domain-ready values. Policies answer access questions without writing responses where possible; controllers translate policy failures to HTTP. Mappers are the only boundary that converts persistence/domain values into `@taskforge/contracts` objects.

## Route boundary map

| Route module | Transport controller | Application service(s) | Repository / adapter | Mapper / policy |
| --- | --- | --- | --- | --- |
| `auth.ts` | Login and current-user HTTP handlers | `authenticateUser`, `getCurrentUser` | `UserRepository`, password and JWT adapters | `UserMapper`, auth policy |
| `projects.ts` | Project CRUD and membership handlers | Project lifecycle and membership use cases | `ProjectRepository`, `MembershipRepository`, transaction adapter | `ProjectMapper`, `UserMapper`, project access/owner policy |
| `phases.ts` | Phase list/create/update/delete handlers | Phase lifecycle and active-phase use cases | `PhaseRepository`, task phase assignment repository | `PhaseMapper`, project access policy |
| `tasks.ts` | Task CRUD, tags, dependencies, and updates handlers | `CreateTask`, `UpdateTask`, `DeleteTask`, `AddTaskUpdate` | `TaskRepository`, `TagRepository`, `DependencyRepository`, `TaskUpdateRepository`, transaction adapter | `TaskMapper`, `TaskUpdateMapper`, project/task policy |
| `users.ts` | Profile, agent, token handlers | Profile and agent identity/token use cases | `UserRepository`, `ApiTokenRepository`, token/hash adapters | `UserMapper`, token metadata mapper, admin policy |
| `notifications.ts` | List/read/read-all handlers | Notification read use cases | `NotificationRepository` | `NotificationMapper`, current-user policy |
| `search.ts` | Search query handler | Search accessible tasks use case | `SearchRepository` (or task query repository) | `TaskSearchMapper`, access policy |
| `context.ts` | Shareable project/task context resolver | Resolve context use case | `ProjectRepository`, `TaskRepository` | `ProjectMapper`, `TaskMapper`, project access policy |
| `app.ts` and `lib/auth.ts` | Health endpoint, auth hook, error handler | Error classification and authentication services | JWT/password adapters | Error presenter and auth context factory |

Cross-cutting activity logging and notifications should be service collaborators (or domain event handlers), not SQL helper functions called directly from routes. The database transaction adapter should be injected into services so a use case can commit its writes atomically on both supported drivers.

## Current coupling and risks

- Route handlers import the global `db`, construct SQL, choose transaction boundaries, validate relations, map rows, and orchestrate notifications/activity in one function.
- `tasks.ts` is the highest-risk module: task writes also mutate tags, dependencies, project timestamps, activity, and notifications; `toTask` performs additional queries and can create N+1 behavior in list endpoints.
- `lib/rows.ts` mixes pure user/project mapping with database-backed task enrichment, making response mapping dependent on global database state.
- `lib/access.ts` both queries authorization data and writes HTTP responses, which makes policy behavior difficult to reuse in services or jobs.
- SQL portability is handled inline with `db.dialect` and SQL string substitutions. Moving this into repositories prevents SQLite/MySQL conditionals from leaking into application logic.
- Several handlers use dynamic update-column lists. Repository methods must keep column allowlists and parameter binding; never pass client field names through to SQL.
- Deleting users, projects, tasks, or phases relies on foreign-key behavior. Repository tests must verify cascade/set-null behavior on SQLite and MySQL before changing transaction order.
- Error handling currently depends on matching driver error strings (`UNIQUE`, `Duplicate entry`). Repositories should expose typed conflict/not-found errors and the HTTP error presenter should map them consistently.

## Agreed migration sequence

1. **TAS-5:** Keep this inventory and agree on boundaries (this note).
2. **TAS-6:** Define service/repository contracts, typed errors, transaction context, and stable inputs/outputs.
3. **TAS-7:** Implement repositories and the SQLite/MySQL adapter boundary without changing route behavior.
4. **TAS-8:** Extract task application services first because tasks exercise the most cross-cutting behavior.
5. **TAS-9:** Refactor project, phase, user, and auth controllers into thin handlers.
6. **TAS-10:** Refactor task, context, search, notification, and update controllers.
7. **TAS-11:** Add architecture checks, service/repository tests, driver coverage, and contributor guidance.

Each step should leave the API contract unchanged and be independently deployable. A route is considered migrated when it only parses/validates transport input, invokes a policy and service, and presents the service result.

## Conventions for follow-up tasks

- Services receive explicit actor/access context rather than Fastify `request` or `reply` objects.
- Repositories receive typed parameters and return records; they do not emit HTTP errors or notifications.
- Policies return decisions/reasons; controllers or a shared presenter choose status codes.
- Mappers are pure where possible. Database-backed enrichment belongs in a repository query or service composition, not in a mapper.
- New endpoints must include a service-level test, repository/adapter coverage, and one HTTP contract test.
