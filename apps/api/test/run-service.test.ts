import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentRunApplicationService } from "../src/application/run-service.js";
import type { AgentRunEntity, ProjectEntity, TaskEntity } from "../src/application/models.js";
import type { RepositorySet } from "../src/application/repositories.js";

const project: ProjectEntity = { id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, color: "#000", availableStatuses: ["TODO", "IN_PROGRESS", "DONE"], defaultStatus: "TODO", ownerId: "owner-1", createdAt: "", updatedAt: "" };
const task: TaskEntity = { id: "task-1", projectId: project.id, number: 1, title: "Run", description: "", definitionOfDone: "", status: "TODO", priority: "MEDIUM", type: "FEATURE", assigneeId: null, creatorId: "owner-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "" };
const actor = { actor: { userId: "runner-1", name: "Runner", kind: "AGENT" as const, role: "MEMBER" as const, tokenScopes: null } };

function base(overrides: Partial<RepositorySet> = {}): RepositorySet {
  return {
    projects: { findById: async () => project } as never,
    memberships: { isMember: async () => true } as never,
    tasks: { findById: async () => task } as never,
    runs: {} as never,
    users: {} as never, phases: {} as never, tags: {} as never, dependencies: {} as never, updates: {} as never,
    attachments: {} as never, automations: {} as never, notifications: {} as never, activity: {} as never,
    webhookDeliveries: {} as never, reporting: {} as never, tokens: {} as never, search: {} as never,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRunEntity> = {}): AgentRunEntity {
  return { id: "run-1", taskId: task.id, projectId: project.id, requestedById: "owner-1", kind: "IMPLEMENTATION", status: "PENDING", attemptCount: 0, maxAttempts: 2, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: null, lastError: null, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z", completedAt: null, ...overrides };
}

test("run claims are race-safe: only one concurrent claimant wins", async () => {
  let claims = 0;
  const current = run();
  const set = base({ runs: {
    expire: async () => 0, findById: async () => current, countForTask: async () => 0,
    claim: async () => { claims += 1; return claims === 1; },
  } as never });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T10:01:00.000Z");
  const results = await Promise.allSettled([service.claim(actor, current.id), service.claim({ actor: { ...actor.actor, userId: "runner-2" } }, current.id)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("expired leases are reaped before reclaim and become retryable", async () => {
  let current = run({ status: "RUNNING", leaseOwner: "dead-runner", leaseExpiresAt: "2026-08-24T09:00:00.000Z", attemptCount: 1 });
  const set = base({ runs: {
    expire: async () => { current = { ...current, status: "FAILED", leaseOwner: null, leaseExpiresAt: null, lastError: "Run lease or timeout expired" }; return 1; },
    findById: async () => current, countForTask: async () => 1, claim: async () => { current = { ...current, status: "RUNNING", leaseOwner: "runner-1", attemptCount: 2 }; return true; },
  } as never });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T10:01:00.000Z");
  const reclaimed = await service.claim(actor, current.id);
  assert.equal(reclaimed?.status, "RUNNING");
  assert.equal(reclaimed?.attemptCount, 2);
});

test("attempt budget is enforced before claiming another attempt", async () => {
  const current = run({ attemptCount: 2, maxAttempts: 2, status: "FAILED" });
  let claimed = false;
  const set = base({ runs: { expire: async () => 0, findById: async () => current, countForTask: async () => 1, claim: async () => { claimed = true; return true; } } as never });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.claim(actor, current.id), /exhausted its retry budget/);
  assert.equal(claimed, false);
});

test("only project owners and admins can cancel a run", async () => {
  const current = run({ status: "RUNNING", leaseOwner: "runner-1" });
  const set = base({ runs: { expire: async () => 0, findById: async () => current, cancel: async () => true } as never });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.complete(actor, current.id, "CANCELLED"), /project owner or administrator/);
  await service.complete({ actor: { ...actor.actor, role: "ADMIN" } }, current.id, "CANCELLED");
});
