# Smithy handoff automations (beta)

Smithy does not choose agents or change task status. A project owner (or administrator) chooses the assignee and creates the handoff rules below. The assigned agent owns its status transitions through the TaskForge API; Smithy only delivers the signed prompt and records the run.

These recipes are examples, not a migration or a global default. Creating a project, upgrading the database, or enabling `agentWorkflow` never creates automations. Add them explicitly from the project settings Automations page or with the API after confirming the status keys and agent IDs for that project.

## Before creating rules

1. Read `project.availableStatuses` and `project.agentWorkflow` from `GET /api/context?project=<KEY>`.
2. Enable the statuses required by the mapping in Project settings. A rule that references a disabled status is rejected with a validation error.
3. Find the implementation and review agent IDs with `GET /api/users`. Use IDs, not display names, in `actorId` or action values.
4. Decide which agent owns each role. A common setup uses one implementation agent (Claude, Codex, or another configured provider) and a separate review agent.
5. Create rules in the order shown below. Rules run on task updates and are evaluated in the project that owns the task.

The examples use `<PROJECT_ID>`, `<IMPLEMENTER_ID>`, and `<REVIEWER_ID>` placeholders. Replace them before sending the request. The status keys are discoverable values; if a project maps a role to a different enabled key, use that key instead.

## Recommended recipes

### 1. Queue implementation work

When a task enters the configured queue/start status, assign the implementation agent. If tasks are assigned manually, this rule is optional because the assignment event already starts the implementation prompt.

```http
POST /api/projects/<PROJECT_ID>/automations
```

```json
{
  "name": "Assign implementation agent",
  "trigger": "TASK_UPDATED",
  "conditions": [
    {"field": "status", "operator": "changed_to", "value": "TODO"},
    {"field": "assigneeId", "operator": "is_empty", "value": null}
  ],
  "actions": [
    {"field": "assigneeId", "valueType": "user", "value": "<IMPLEMENTER_ID>"}
  ]
}
```

The implementation prompt includes the task description, definition of done, repository and branch, enabled statuses, and the configured workflow. The agent should move the task to the mapped implementation status (usually `IN_PROGRESS`) before working and to the mapped review-queue status (usually `READY_FOR_REVIEW`) when its work is ready.

### 2. Route the first review

```json
{
  "name": "Assign reviewer",
  "trigger": "TASK_UPDATED",
  "conditions": [
    {"field": "status", "operator": "changed_to", "value": "READY_FOR_REVIEW"}
  ],
  "actions": [
    {"field": "assigneeId", "valueType": "user", "value": "<REVIEWER_ID>"}
  ]
}
```

The reviewer receives a review prompt when the assignment is delivered. It must compare the current branch/head with every DoD item, tests, and code quality, record findings in the findings/logs APIs, and choose the configured approval or fix-needed status. The reviewer, not Smithy, performs that status PATCH.

### 3. Route requested fixes

```json
{
  "name": "Assign implementation agent for fixes",
  "trigger": "TASK_UPDATED",
  "conditions": [
    {"field": "status", "operator": "changed_to", "value": "FIX_NEEDED"}
  ],
  "actions": [
    {"field": "assigneeId", "valueType": "user", "value": "<IMPLEMENTER_ID>"}
  ]
}
```

The fix-needed prompt includes the latest human review updates and provider findings. The implementer stays on the existing branch, resolves each finding, moves the task through the mapped fix-in-progress status (usually `FIX_IN_PROGRESS`), and moves it to the mapped re-review status (`RE_REVIEW`) when ready.

### 4. Route re-review

```json
{
  "name": "Assign reviewer for re-review",
  "trigger": "TASK_UPDATED",
  "conditions": [
    {"field": "status", "operator": "changed_to", "value": "RE_REVIEW"}
  ],
  "actions": [
    {"field": "assigneeId", "valueType": "user", "value": "<REVIEWER_ID>"}
  ]
}
```

Re-review compares the new head SHA with the prior findings and DoD. A clean review may move the task to the configured approval status (`APPROVED` in the standard mapping); unresolved findings should return it to `FIX_NEEDED`. A human still authorizes merge and completion.

## Ownership and safety rules

- Project owners and administrators manage automations. Members can trigger a rule but cannot edit its configuration.
- Agents own lifecycle status changes. Smithy never silently changes a task status, substitutes a disabled key, or turns a successful run into approval.
- The assignment event is the routing boundary. Ordinary task notes/updates do not start a run.
- Keep implementation and review agents distinct when independent review is required. If the same identity is used, record that decision explicitly in the task.
- Disable or update a rule before disabling a status it references. The API rejects status references that are not enabled in the project.
- If a handoff fails, the automation error is audited and remains visible to the caller; retry the assignment after correcting the rule or agent membership.

## Troubleshooting

- **“Status X is not available in this project”**: discover the current `availableStatuses`, enable the status in Project settings, or change the rule to the role's configured mapping. Do not guess a replacement key.
- **No run starts**: confirm the task was assigned to the intended agent and that its webhook URL points to the running Smithy path. A status update without an assignment is intentionally inert.
- **Wrong agent receives work**: inspect all enabled rules for the same `changed_to` status and verify each action's user ID. Rules are evaluated in project order and assignments are auditable.
- **Agent is missing**: create/configure the agent identity, add it to the project, and configure its Smithy webhook before enabling the recipe.
- **Looping handoffs**: ensure a rule changes only `assigneeId` and does not re-trigger a status transition. Keep the workflow mapping complete and rely on run cycle limits for recovery.
