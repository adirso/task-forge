import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskApplicationService } from "../src/application/task-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

function repositories(overrides: Partial<RepositorySet> = {}): RepositorySet {
  return {
    projects: { findById: async () => ({ id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000000", ownerId: "owner-1", createdAt: "", updatedAt: "" }) } as never,
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
