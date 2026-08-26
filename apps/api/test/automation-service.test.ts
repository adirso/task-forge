import assert from "node:assert/strict";
import { test } from "node:test";
import { AutomationEngine, AutomationFailureError } from "../src/application/automation-service.js";
import type { RequestContext } from "../src/application/context.js";
import type { RepositorySet } from "../src/application/repositories.js";

const context: RequestContext = {
  actor: { userId: "agent-1", name: "Runner", kind: "AGENT", role: "MEMBER", tokenScopes: null },
};
const task = {
  id: "task-1", projectId: "project-1", number: 1, title: "Workflow", description: "", definitionOfDone: "",
  status: "READY_FOR_REVIEW", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1",
  parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null,
  pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "",
} as const;

function rule() {
  return {
    id: "automation-1", projectId: "project-1", name: "handoff", enabled: true, trigger: "TASK_UPDATED",
    actorType: "ANY", actorId: null, service: null, conditions: [],
    actions: [{ field: "status", valueType: "static", value: "IN_REVIEW" }], createdAt: "", updatedAt: "",
  } as never;
}

test("automation can match an exact status transition", async () => {
  const repositories = {
    automations: { listForProject: async () => [{ ...rule(), conditions: [{ field: "status", operator: "changed_from_to", fromValue: "TODO", value: "IN_REVIEW" }], actions: [{ field: "status", valueType: "static", value: "DONE" }] }] },
    tasks: { update: async (_id: string, patch: Record<string, unknown>) => ({ ...task, ...patch }) },
    activity: { record: async () => undefined },
  } as unknown as RepositorySet;

  const engine = new AutomationEngine();
  const result = await engine.apply(repositories, context, { ...task, status: "TODO" }, { ...task, status: "IN_REVIEW" }, "TASK_UPDATED");
  assert.equal(result.status, "DONE");
  const unchanged = await engine.apply(repositories, context, { ...task, status: "IN_PROGRESS" }, { ...task, status: "IN_REVIEW" }, "TASK_UPDATED");
  assert.equal(unchanged.status, "IN_REVIEW");
});

test("automation side effects are auditable when a handoff succeeds", async () => {
  const events: Array<{ action: string; metadata: unknown }> = [];
  const repositories = {
    automations: { listForProject: async () => [rule()] },
    tasks: { update: async (_id: string, patch: Record<string, unknown>) => ({ ...task, ...patch }) },
    activity: { record: async (event: { action: string; metadata: unknown }) => { events.push(event); } },
  } as unknown as RepositorySet;

  const result = await new AutomationEngine().apply(repositories, context, task, task, "TASK_UPDATED");
  assert.equal(result.status, "IN_REVIEW");
  assert.deepEqual(events, [{ projectId: "project-1", taskId: "task-1", actorId: "agent-1", action: "automation.applied", metadata: { automationId: "automation-1", trigger: "TASK_UPDATED", patch: { status: "IN_REVIEW" } } }]);
});

test("automation handoff failures are audited and remain visible to the caller", async () => {
  const repositories = {
    automations: { listForProject: async () => [rule()] },
    tasks: { update: async () => { throw new Error("database unavailable"); } },
    activity: { record: async () => undefined },
  } as unknown as RepositorySet;

  await assert.rejects(
    () => new AutomationEngine().apply(repositories, context, task, task, "TASK_UPDATED"),
    (error: unknown) => error instanceof AutomationFailureError
      && error.auditEvent.action === "automation.failed"
      && error.auditEvent.metadata.error === "database unavailable",
  );
});
