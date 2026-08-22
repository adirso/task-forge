import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskApplicationService } from "../src/application/task-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

function repositories(overrides: Partial<RepositorySet> = {}): RepositorySet {
  return {
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", availableStatuses: ["BACKLOG", "REFINING", "TODO", "READY_FOR_DEV", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "DONE", "CANCELLED"], defaultStatus: "TODO", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
    memberships: { isMember: async () => true } as never,
    tasks: { allocateNumber: async () => ({ number: 7, position: 2 }), create: async (task: unknown) => task } as never,
    phases: { findById: async () => null } as never,
    tags: { replaceForTask: async () => undefined } as never,
    dependencies: { replaceForTask: async () => undefined } as never,
    activity: { record: async () => undefined } as never,
    notifications: { notify: async () => undefined } as never,
    users: {} as never, updates: {} as never, tokens: {} as never, search: {} as never,
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

test("adding an update dispatches a webhook to the assigned agent", async (t) => {
  const dispatched: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    dispatched.push({ url: String(input), payload: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(null, { status: 204 });
  };
  const task = {
    id: "task-39", projectId: "project-1", number: 39, title: "Update webhook", description: "", definitionOfDone: "Adding an update triggers webhook",
    status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: "agent/tas-39",
    dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "",
  };
  const set = repositories({
    tasks: { findById: async () => task } as never,
    updates: { create: async (update: unknown) => update } as never,
    users: { findById: async (id: string) => id === "agent-1" ? { id, name: "Builder", kind: "AGENT", webhookUrl: "https://agent.example.test/webhook" } : { id, name: "Owner", kind: "HUMAN" } } as never,
  });
  const service = new TaskApplicationService({ run: async (work) => work(set) }, () => "2026-08-20T13:30:00.000Z", () => "update-1");

  await service.addUpdate({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "ADMIN", tokenScopes: null } }, task.id, "Please take another look.");

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.url, "https://agent.example.test/webhook");
  assert.deepEqual(dispatched[0]?.payload, {
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

  dispatched.length = 0;
  await service.addUpdate({ actor: { userId: "agent-1", name: "Builder", kind: "AGENT", role: "MEMBER", tokenScopes: null } }, task.id, "Work is in progress.");
  assert.equal(dispatched.length, 0, "an agent's own update must not trigger its webhook");
});
