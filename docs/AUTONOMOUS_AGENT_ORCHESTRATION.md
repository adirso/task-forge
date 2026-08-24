# Autonomous delivery and review workflow

This document proposes a controlled delivery loop for TaskForge in which a human starts work, a coordinating agent delegates implementation to Claude, and Codex reviews the resulting pull request. It is a design for Phase 5; existing projects keep their current workflow until the new statuses and guards are enabled explicitly.

## Roles and ownership

| Role | Owns | Must not do |
| --- | --- | --- |
| Human requester | Scope, priority, approval policy, final merge authorization | Delegate authority implicitly by posting a note |
| Coordinating agent | Task assignment, run creation, leases, status transitions, evidence collection, escalation | Merge without an explicit human/project policy grant |
| Claude implementation agent | Repository changes on an isolated branch, tests, PR, implementation handoff | Change workflow policy or self-approve |
| Codex review agent | Review evidence, findings, disposition recommendation | Approve its own implementation or bypass CI |

The task remains the source of truth. Every automated action is associated with an immutable `runId`, `taskId`, `actorId`, and `attempt`; the current assignee owns execution while the coordinating agent owns orchestration.

## Proposed state machine

Existing statuses (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`) remain valid. Phase 5 adds these optional semantic statuses to a project workflow:

`READY_FOR_AGENT` -> `IMPLEMENTING` -> `WAITING_FOR_REVIEW` -> `REVIEWING` -> `APPROVED` -> `MERGE_PENDING` -> `DONE`

Exception paths are `CHANGES_REQUESTED` (review findings require a fix), `PENDING_DECISION` (a human decision or external dependency is needed), `CANCELLED`, and `FAILED` (terminal run failure with retry/escalation controls). A project may use different keys, but each enabled key must declare its semantic category and transition capabilities.

| Transition | Guard | Owner/evidence |
| --- | --- | --- |
| Ready → Implementing | task assigned, lease acquired, implementation agent configured | Coordinator; run record |
| Implementing → Waiting for review | branch/PR exists, required tests recorded, agent handoff complete | Claude; PR URL + commit SHA |
| Waiting for review → Reviewing | PR is reachable and reviewer lease acquired | Coordinator/Codex |
| Reviewing → Approved | required CI checks green, no blocking findings, reviewer attestation | Codex; review evidence |
| Reviewing → Changes requested | one or more P0–P2 findings or explicitly selected P3 finding | Codex; finding records |
| Reviewing → Pending decision | finding needs product/security/owner decision | Human/coordinator; decision note |
| Approved → Merge pending | human/project merge policy authorizes merge | Coordinator; authorization record |
| Merge pending → Done | merge SHA exists and post-merge CI/deploy check passes | Coordinator; merge evidence |
| Any non-terminal → Cancelled | human or authorized coordinator cancellation | Actor + reason |
| Implementing/Reviewing → Failed | timeout or exhausted retries | Runner; diagnostics + escalation |

Transitions are atomic, validate that the previous status matches, and are idempotent on `(runId, transitionId)`. Disabled semantic transitions return an actionable workflow-discovery error rather than silently changing to a legacy key.

## Invocation, context, and monitoring

1. A human creates or assigns a task and selects an automation policy (implementation provider, reviewer provider, max attempts, timeout, and merge mode).
2. The coordinator creates an outbox-backed run and sends the agent an immutable context bundle: task snapshot, project workflow, repository/commit, target branch, acceptance criteria, attachments, prior findings, and allowed API transitions. Secrets are references to scoped credentials, never values in the bundle.
3. A runner claims a lease with a heartbeat. It may renew only its own lease and may resume an interrupted run from the last durable step. Lease expiry moves the run to retryable `FAILED`/`PENDING_DECISION` according to policy.
4. Claude reports progress, test output, PR URL, and final commit. The coordinator validates that the branch and repository match the run before moving to review.
5. Codex receives the same snapshot plus PR diff and CI artifacts, writes structured findings, and chooses approve, changes requested, pending decision, or reject.

Outbox delivery is post-commit, signed per agent, idempotent by event ID, and retried with bounded exponential backoff. A dispatcher wake-up is emitted after enqueue. Missing credentials, invalid signatures, exhausted retries, and terminal failures are visible in an operator queue; payloads, passwords, bearer tokens, and webhook secrets are redacted from logs.

Loop prevention requires the originating run ID and actor on every event, ignores an agent's own update event, rejects duplicate transition IDs, caps implementation/review cycles, and escalates after the cap. Cancellation propagates to the runner, stops new retries, and records the reason. Recovery never replays a merge authorization without a new human decision.

## Pull request, CI, and merge policy

The coordinator records PR number, repository, head/base SHA, required checks, review commit SHA, and merge SHA. Approval requires:

- all repository-required checks green for the exact head SHA;
- Codex review attached to that SHA with no blocking findings;
- no unresolved security or policy finding;
- an explicit human/project-owner merge authorization (or a documented project policy that grants it).

The merge operation is performed by a service account with least privilege and is itself audited. A changed head SHA invalidates approval and returns the task to review.

## Review finding lifecycle

Each finding has severity, file/line evidence, disposition, and author. A finding disposition is distinct from rejecting the whole delivery: the reviewer may reject the implementation/task when it is unsafe, out of scope, or cannot be corrected under policy. For individual findings, the owner may:

- **Accept/no action:** record rationale and continue if policy permits;
- **Fix and re-review:** return to `CHANGES_REQUESTED`, create a new attempt, and require review on the new SHA;
- **Defer:** move to `PENDING_DECISION` with an owner and due date;
- **Reject/close:** record why the finding is invalid or out of scope.

Only the finding owner or an authorized human can change a disposition. A re-review cannot reuse approval from an earlier commit.

## Sequenced Phase 5 implementation plan

These child tasks are intentionally ordered so storage and policy are available before provider execution:

1. **TAS-62 — Workflow statuses and transition guards** — add semantic statuses, role-aware transition policy, atomic transition history, and migration tests. DoD: the full proposed set (`READY_FOR_AGENT`, `IMPLEMENTING`, `WAITING_FOR_REVIEW`, `REVIEWING`, `CHANGES_REQUESTED`, `PENDING_DECISION`, `APPROVED`, `MERGE_PENDING`, `FAILED`, and `CANCELLED`) is representable or explicitly mapped to project-specific keys; disabled transitions fail clearly; duplicate transitions are harmless; legacy workflows continue to work.
2. **TAS-63 — Run, lease, and orchestration service** — persist runs/attempts/leases, claim and heartbeat APIs, timeout/cancellation handling, and bounded cycle limits. DoD: crash recovery and concurrent claims are deterministic in SQLite and MySQL.
3. **TAS-64 — Agent provider adapters and context bundles** — implement Claude/Codex invocation contracts, scoped credentials, immutable context snapshots, and callback authentication. DoD: provider failures are retryable, secrets never enter payloads/logs, and callbacks are idempotent.
4. **TAS-65 — PR/CI evidence and merge authorization** — ingest checks/reviews, invalidate stale approvals, enforce merge guards, and record merge evidence. DoD: no merge occurs without configured checks and authorization; head changes require re-review.
5. **TAS-66 — Findings, decisions, and operator controls** — structured finding UI/API, accept/fix/defer/reject paths, escalation queue, cancellation, and manual retry. DoD: every terminal decision is auditable and a fix creates a new review attempt.
6. **TAS-67 — Notifications, audit, and recovery hardening** — durable event delivery, redaction, metrics, dashboards, retention, and disaster-recovery tests. DoD: duplicate/out-of-order events do not loop runs and restore/replay behavior is documented and tested.

TaskForge dependency edges are configured in the same order: TAS-62 → TAS-63 → TAS-64 → TAS-65 → TAS-66 → TAS-67.

## Open product decisions

- Which exact status keys and categories are enabled by default, and whether `APPROVED` is separate from `MERGE_PENDING`.
- Whether merge authorization is always human-gated or can be granted per project; who may grant it.
- Supported Claude/Codex execution environments, network access, cost limits, and maximum wall-clock time.
- Required CI checks and whether external deployments must pass before `DONE`.
- Retention and visibility of prompts, diffs, logs, findings, and audit records.
- Cancellation semantics for already-running provider calls and in-flight merges.
- Whether a pending decision blocks the task or permits unrelated work to continue.
