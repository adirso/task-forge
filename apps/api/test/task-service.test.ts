import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskApplicationService } from "../src/application/task-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

function repositories(overrides: Partial<RepositorySet> = {}): RepositorySet {
  return {
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "DONE", "CANCELLED"], defaultStatus: "TODO", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    memberships: { isMember: async () => true } as never,
    tasks: { allocateNumber: async () => ({ number: 7, position: 2 }), create: async (task: unknown) => task } as never,
    phases: { findById: async () => null } as never,
    tags: { replaceForTask: async () => undefined } as never,
    dependencies: { replaceForTask: async () => undefined } as never,
    activity: { record: async () => undefined } as never,
    notifications: { notify: async () => undefined } as never,
    webhookDeliveries: { create: async (delivery: unknown) => delivery } as never,
    reporting: {} as never, runs: { findById: async () => null } as never,
    users: { findById: async () => null } as never, updates: {} as never, tokens: {} as never, search: {} as never,
    ...overrides,
  };
}

test("task service allocates task identity and records cross-cutting effects", async () => {
  const calls: string[] = [];
  const set = repositories({
    tasks: { allocateNumber: async () => ({ number: 7, position: 2 }), create: async (task: unknown) => { calls.push("create"); return task; } } as never,
    activity: { record: async () => { calls.push("activity"); } } as never,
    tags: { replaceForTask: async () => { calls.push("tags"); } } as never,
    dependencies: { replaceForTask: async () => { calls.push("dependencies"); } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-01-01T00:00:00.000Z", () => "task-7");
  const task = await service.create({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN" }, projectId: "project-1" }, {
    title: "Extract task service", description: "", definitionOfDone: "Tests pass", status: "TODO", priority: "HIGH", assigneeId: null,
    parentId: null, branch: null, dueDate: null, estimatePoints: 5, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null,
    tags: ["backend"], dependencyIds: [],
  });
  assert.equal(task.id, "task-7");
  assert.equal(task.number, 7);
  assert.equal(task.type, "FEATURE");
  assert.deepEqual(calls, ["create", "tags", "dependencies", "activity"]);
});

test("task service rejects self dependencies before persistence", async () => {
  let created = false;
  const set = repositories({
    tasks: { allocateNumber: async () => ({ number: 8, position: 0 }), create: async () => { created = true; return null; }, findById: async (id: string) => id === "task-8" ? { id, projectId: "project-1" } : null } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.update({ actor: { userId: "owner-1", kind: "HUMAN", role: "ADMIN" }, correlationId: "test" }, "task-8", { dependencyIds: ["task-8"] }), /cannot depend on itself/);
  assert.equal(created, false);
});

test("task claiming passes enabled sources and target to the atomic repository operation", async () => {
  let workflow: { sourceStatuses: string[]; targetStatus: string } | undefined;
  const claimed = {
    id: "task-49", projectId: "project-1", number: 49, title: "Ready work", description: "", definitionOfDone: "", status: "IN_PROGRESS", priority: "HIGH", type: "BUG",
    assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null,
    pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "",
  };
  const set = repositories({
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["TODO", "IN_PROGRESS", "DONE"], defaultStatus: "TODO", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    tasks: { claimNext: async (_projectId: string, _claimantId: string, input: typeof workflow) => { workflow = input; return claimed; } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  const task = await service.claimTask({ actor: { userId: "agent-1", kind: "AGENT", role: "MEMBER", tokenScopes: ["task:claim"] }, projectId: "project-1" });
  assert.equal(task.id, "task-49");
  assert.deepEqual(workflow, { sourceStatuses: ["TODO"], targetStatus: "IN_PROGRESS" });
});

test("task claiming reports actionable workflow configuration errors", async () => {
  let availableStatuses = ["TODO", "DONE"];
  const set = repositories({
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses, defaultStatus: availableStatuses[0], ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    tasks: { claimNext: async () => { throw new Error("claim repository must not run for an invalid workflow"); } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  const context = { actor: { userId: "agent-1", kind: "AGENT" as const, role: "MEMBER" as const, tokenScopes: ["task:claim" as const] }, projectId: "project-1" };
  await assert.rejects(() => service.claimTask(context), /requires IN_PROGRESS to be enabled.*project settings/);
  availableStatuses = ["IN_PROGRESS", "DONE"];
  await assert.rejects(() => service.claimTask(context), /requires at least one claim source status \(BACKLOG, TODO\).*project settings/);
});

test("adding an update durably enqueues an event and prevents an assignee loop", async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  const task = {
    id: "task-39", projectId: "project-1", number: 39, title: "Update webhook", description: "", definitionOfDone: "Adding an update triggers webhook",
    status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: "agent/tas-39",
    dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "",
  };
  const set = repositories({
    tasks: { findById: async () => task } as never,
    updates: { create: async (update: unknown) => update } as never,
    users: { findById: async (id: string) => id === "agent-1" ? { id, name: "Builder", kind: "AGENT", webhookUrl: "https://agent.example.test/webhook" } : { id, name: "Owner", kind: "HUMAN" } } as never,
    webhookDeliveries: { create: async (delivery: Record<string, unknown>) => { deliveries.push(delivery); return delivery; } } as never,
  });
  const ids = ["update-1", "event-1", "update-2"];
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-08-20T13:30:00.000Z", () => ids.shift()!);

  await service.addUpdate({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, task.id, "Please take another look.");

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.id, "event-1");
  assert.equal(deliveries[0]?.status, "PENDING");
  assert.equal(deliveries[0]?.attemptCount, 0);
  assert.deepEqual(JSON.parse(String(deliveries[0]?.payload)), {
    id: "event-1",
    event: "task.update_added",
    task: {
      id: "task-39", number: 39, title: "Update webhook", description: "", definitionOfDone: "Adding an update triggers webhook",
      status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", branch: "agent/tas-39", projectId: "project-1",
      projectKey: "TAS", projectName: "Task Forge", assigneeId: "agent-1",
    },
    update: { id: "update-1", body: "Please take another look.", authorId: "owner-1", createdAt: "2026-08-20T13:30:00.000Z" },
    postedBy: { id: "owner-1", name: "Owner" },
    timestamp: "2026-08-20T13:30:00.000Z",
  });

  await service.addUpdate({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, task.id, "Work is in progress.");
  assert.equal(deliveries.length, 1, "an agent's own update must not enqueue its webhook");
});

test("assignment events are enqueued only for another agent actor", async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  const existing = {
    id: "task-51", projectId: "project-1", number: 51, title: "Durable delivery", description: "", definitionOfDone: "",
    status: "TODO", priority: "HIGH", type: "SECURITY", assigneeId: null, creatorId: "owner-1", parentId: null, branch: null,
    dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null,
    position: 0, createdAt: "2026-08-23T10:00:00.000Z", updatedAt: "2026-08-23T10:00:00.000Z",
  } as const;
  const set = repositories({
    tasks: { findById: async () => existing, update: async (_id: string, input: Record<string, unknown>) => ({ ...existing, ...input }) } as never,
    users: { findById: async (id: string) => id === "agent-1" ? { id, name: "Builder", kind: "AGENT", webhookUrl: "https://agent.example/webhook" } : null } as never,
    webhookDeliveries: { create: async (delivery: Record<string, unknown>) => { deliveries.push(delivery); return delivery; } } as never,
  });
  const ids = ["event-1", "event-2"];
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-08-23T10:00:00.000Z", () => ids.shift()!);

  await service.update({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, existing.id, { assigneeId: "agent-1" });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "task.assigned");
  assert.equal(JSON.parse(String(deliveries[0]?.payload)).id, "event-1");

  await service.update({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, existing.id, { assigneeId: "agent-1" });
  assert.equal(deliveries.length, 1, "an agent assigning itself must not enqueue its own webhook");
});

test("status changes enqueue a signed-delivery event for another agent", async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  const existing = {
    id: "task-62", projectId: "project-1", number: 62, title: "Workflow status", description: "", definitionOfDone: "",
    status: "IN_PROGRESS", priority: "HIGH", type: "INFRA", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: null,
    dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null,
    position: 0, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z",
  } as const;
  const set = repositories({
    tasks: { findById: async () => existing, update: async (_id: string, input: Record<string, unknown>) => ({ ...existing, ...input }) } as never,
    users: { findById: async (id: string) => id === "agent-1" ? { id, name: "Builder", kind: "AGENT", webhookUrl: "https://agent.example/webhook" } : null } as never,
    webhookDeliveries: { create: async (delivery: Record<string, unknown>) => { deliveries.push(delivery); return delivery; } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T10:05:00.000Z", () => "event-status-1");

  await service.update({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, existing.id, { status: "READY_FOR_REVIEW" });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "task.status_changed");
  assert.deepEqual(JSON.parse(String(deliveries[0]?.payload)), {
    id: "event-status-1",
    event: "task.status_changed",
    task: { id: "task-62", number: 62, title: "Workflow status", description: "", definitionOfDone: "", status: "READY_FOR_REVIEW", priority: "HIGH", type: "INFRA", branch: null, projectId: "project-1", projectKey: "TAS", projectName: "Task Forge", assigneeId: "agent-1" },
    previousStatus: "IN_PROGRESS",
    runId: null,
    changedBy: { id: "owner-1", name: "Owner" },
    timestamp: "2026-08-24T10:05:00.000Z",
  });

  await service.update({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, existing.id, { status: "IN_REVIEW" });
  assert.equal(deliveries.length, 1, "an agent's own status change must not enqueue its webhook");
});

test("tasks can move between any statuses enabled by the project workflow", async () => {
  const task = {
    id: "task-guard", projectId: "project-1", number: 63, title: "Guarded workflow", description: "", definitionOfDone: "",
    status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: null, creatorId: "owner-1", parentId: null, branch: null,
    dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null,
    position: 0, createdAt: "", updatedAt: "",
  } as const;
  const set = repositories({
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "APPROVED", "FIX_NEEDED", "DONE"], defaultStatus: "IN_PROGRESS", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    tasks: { findById: async () => task, update: async (_id: string, input: Record<string, unknown>) => ({ ...task, ...input }) } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  await service.update({ actor: { userId: "owner-1", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, task.id, { status: "DONE" });
  await service.update({ actor: { userId: "owner-1", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, task.id, { status: "READY_FOR_REVIEW" });
});

test("agent API clients may hand off published task evidence without a Smithy run", async () => {
  const task = {
    id: "task-manual-handoff", projectId: "project-1", number: 65, title: "Manual handoff", description: "", definitionOfDone: "",
    status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null,
    branch: "agent/manual", dueDate: null, estimatePoints: null, phaseId: null,
    pullRequestUrl: "https://github.com/acme/app/pull/65", pullRequestTitle: "Manual handoff", pullRequestState: "OPEN",
    position: 0, createdAt: "", updatedAt: "",
  } as const;
  let updated = task;
  const set = repositories({
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["IN_PROGRESS", "READY_FOR_REVIEW"], defaultStatus: "IN_PROGRESS", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    tasks: { findById: async () => updated, update: async (_id: string, input: Record<string, unknown>) => { updated = { ...task, ...input }; return updated; } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  const result = await service.update({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, task.id, { status: "READY_FOR_REVIEW" });
  assert.equal(result.status, "READY_FOR_REVIEW");
});

test("agent handoff without a run still rejects missing publication evidence", async () => {
  const task = { id: "task-unpublished", projectId: "project-1", number: 66, title: "Unpublished", description: "", definitionOfDone: "", status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "" } as const;
  const set = repositories({ tasks: { findById: async () => task } as never });
  const service = new TaskApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.update({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, task.id, { status: "READY_FOR_REVIEW" }), /published branch, head SHA, and pull request evidence/);
});

test("claim emits a status-changed event with the source status", async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  const claimed = { id: "task-claim", projectId: "project-1", number: 64, title: "Claimed", description: "", definitionOfDone: "", status: "IN_PROGRESS", priority: "HIGH", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "", previousStatus: "TODO" };
  const set = repositories({
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["TODO", "IN_PROGRESS", "APPROVED"], defaultStatus: "TODO", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    tasks: { claimNext: async () => claimed } as never,
    runs: { findById: async () => ({ id: "00000000-0000-4000-8000-000000000063", taskId: claimed.id, projectId: claimed.projectId, status: "PENDING", maxAttempts: 2, attemptCount: 0 }) } as never,
    users: { findById: async (id: string) => id === "agent-1" ? { id, name: "Builder", kind: "AGENT", webhookUrl: "https://agent.example/webhook" } : null } as never,
    webhookDeliveries: { create: async (delivery: Record<string, unknown>) => { deliveries.push(delivery); return delivery; } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T10:10:00.000Z", () => "claim-event");
  await service.claimTask({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN", tokenScopes: ["task:claim"] }, projectId: "project-1" }, { runId: "00000000-0000-4000-8000-000000000063" });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.eventType, "task.status_changed");
  assert.equal(JSON.parse(String(deliveries[0]?.payload)).previousStatus, "TODO");
  assert.equal(JSON.parse(String(deliveries[0]?.payload)).runId, "00000000-0000-4000-8000-000000000063");
});
