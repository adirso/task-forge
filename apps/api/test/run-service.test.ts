import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentRunApplicationService } from "../src/application/run-service.js";
import type { AgentRunEntity, ProjectEntity, TaskEntity } from "../src/application/models.js";
import type { RepositorySet } from "../src/application/repositories.js";

const project: ProjectEntity = { id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: null, localRepoPath: null, color: "#000", sortOrder: 0, availableStatuses: ["TODO", "IN_PROGRESS", "DONE"], defaultStatus: "TODO", agentWorkflow: null, hiddenEmptyStatuses: ["TODO", "IN_PROGRESS", "DONE"], mergeTarget: "main", dependencyResolutionStatuses: ["DONE", "CANCELLED"], reviewPolicy: { requireIndependentReview: false, requiredReviewerCount: 1, allowedReviewerAgentIds: [] }, ownerId: "owner-1", createdAt: "", updatedAt: "" };
const task: TaskEntity = { id: "task-1", projectId: project.id, number: 1, title: "Run", description: "", definitionOfDone: "", status: "TODO", priority: "MEDIUM", type: "FEATURE", assigneeId: null, creatorId: "owner-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "", updatedAt: "" };
const actor = { actor: { userId: "runner-1", name: "Runner", kind: "AGENT" as const, role: "MEMBER" as const, tokenScopes: null } };
const owner = { actor: { userId: "owner-1", name: "Owner", kind: "HUMAN" as const, role: "MEMBER" as const, tokenScopes: null } };

function base(overrides: Partial<RepositorySet> = {}): RepositorySet {
  return {
    projects: { findById: async () => project } as never,
    memberships: { isMember: async () => true } as never,
    tasks: { findById: async () => task } as never,
    runs: {} as never,
    users: {} as never, phases: {} as never, tags: {} as never, dependencies: {} as never, updates: {} as never,
    attachments: {} as never, automations: {} as never, notifications: {} as never, activity: {} as never,
    webhookDeliveries: {} as never, reporting: {} as never, tokens: { revokeRunCredential: async () => undefined } as never, search: {} as never,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRunEntity> = {}): AgentRunEntity {
  return { id: "run-1", taskId: task.id, projectId: project.id, requestedById: "owner-1", executedById: null, kind: "IMPLEMENTATION", status: "PENDING", controlState: "ACTIVE", controlVersion: 0, assignedAgentId: null, inputRequest: null, inputResponse: null, inputRequestedAt: null, inputAnsweredAt: null, takeoverById: null, attemptCount: 0, maxAttempts: 2, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: null, lastError: null, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:00.000Z", completedAt: null, ...overrides };
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

test("only project owners and admins can cancel a run through an idempotent intervention", async () => {
  let current = run({ status: "RUNNING", controlVersion: 1, leaseOwner: "runner-1" });
  const interventions = new Map<string, any>();
  const set = base({
    tasks: { findById: async () => task, update: async () => task } as never,
    runs: {
      findById: async () => current,
      findIntervention: async (id: string) => interventions.get(id) ?? null,
      applyIntervention: async (_id: string, version: number, update: Partial<AgentRunEntity>) => { if (version !== current.controlVersion) return false; current = { ...current, ...update, controlVersion: version + 1 }; return true; },
      recordIntervention: async (entry: any) => { interventions.set(entry.requestId, entry); },
    } as never,
    activity: { record: async () => undefined } as never,
  });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.intervene(actor, current.id, "cancel-1", { action: "CANCEL", controlVersion: 1 }), /project owner or administrator/);
  const first = await service.intervene(owner, current.id, "cancel-1", { action: "CANCEL", controlVersion: 1 });
  assert.equal(first.run?.status, "CANCELLED");
  await assert.rejects(() => service.intervene(actor, current.id, "cancel-1", { action: "CANCEL", controlVersion: 1 }), /another actor/);
  const duplicate = await service.intervene(owner, current.id, "cancel-1", { action: "CANCEL", controlVersion: 1 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(current.controlVersion, 2);
});

test("failed runs can be retried, reassigned, and handed to a human without losing audit or dispatch state", async () => {
  let current = run({ status: "FAILED", controlVersion: 2, attemptCount: 1, assignedAgentId: "runner-1", executedById: "runner-1", lastError: "provider failed", completedAt: "2026-08-24T10:00:30.000Z" });
  let currentTask = { ...task, assigneeId: "runner-1" };
  const deliveries: any[] = [];
  const activities: any[] = [];
  const interventions = new Map<string, any>();
  const set = base({
    tasks: { findById: async () => currentTask, update: async (_id: string, update: Partial<TaskEntity>) => (currentTask = { ...currentTask, ...update }) } as never,
    runs: {
      findById: async () => current,
      findIntervention: async (id: string) => interventions.get(id) ?? null,
      applyIntervention: async (_id: string, version: number, update: Partial<AgentRunEntity>) => { if (version !== current.controlVersion) return false; current = { ...current, ...update, controlVersion: version + 1 }; return true; },
      recordIntervention: async (entry: any) => { interventions.set(entry.requestId, entry); },
    } as never,
    users: { findById: async (id: string) => ({ id, kind: "AGENT", webhookUrl: "http://smithy.test/agent" }), getWebhookConfiguration: async () => ({ webhookUrl: "http://smithy.test/agent", secretCiphertext: "encrypted", secretVersion: 1 }) } as never,
    webhookDeliveries: { create: async (delivery: any) => { deliveries.push(delivery); return delivery; } } as never,
    activity: { record: async (entry: any) => { activities.push(entry); } } as never,
  });
  let nextId = 0;
  const service = new AgentRunApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T10:01:00.000Z", () => `event-${++nextId}`);
  const retried = await service.intervene(owner, current.id, "retry-1", { action: "RETRY", controlVersion: 2 });
  assert.equal(retried.run?.status, "PENDING");
  assert.equal(deliveries.length, 1);
  assert.equal(JSON.parse(deliveries[0].payload).runId, current.id);
  const reassigned = await service.intervene(owner, current.id, "reassign-1", { action: "REASSIGN", controlVersion: 3, agentId: "runner-2" });
  assert.equal(reassigned.run?.assignedAgentId, "runner-2");
  assert.equal(currentTask.assigneeId, "runner-2");
  assert.equal(deliveries.length, 2);
  const takeover = await service.intervene(owner, current.id, "takeover-1", { action: "TAKEOVER", controlVersion: 4 });
  assert.equal(takeover.run?.controlState, "HUMAN_TAKEOVER");
  assert.equal(takeover.run?.status, "CANCELLED");
  assert.equal(currentTask.assigneeId, owner.actor.userId);
  assert.deepEqual(activities.map((entry) => entry.metadata.intervention), ["RETRY", "REASSIGN", "TAKEOVER"]);
});

test("project owners grant exactly one audited cycle and repeated requests are idempotent", async () => {
  const grants = new Map<string, any>();
  const activities: any[] = [];
  const cappedTask = { ...task, assigneeId: "agent-1" };
  const runs = {
    cycleState: async () => ({ count: 6, limit: 6, limitFailure: true, failureEventId: "event-capped" }),
    findCycleGrant: async (requestId: string) => grants.get(requestId) ?? null,
    grantCycle: async (input: any) => { grants.set(input.requestId, input); return { grant: input, created: true }; },
  };
  const set = base({
    tasks: { findById: async () => cappedTask } as never,
    runs: runs as never,
    users: { findById: async () => ({ id: "agent-1", kind: "AGENT" }), getWebhookConfiguration: async () => ({ webhookUrl: "http://127.0.0.1:4500/agents/codex", secretCiphertext: "encrypted", secretVersion: 2 }) } as never,
    activity: { record: async (input: any) => { activities.push(input); } } as never,
  });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) }, () => "2026-09-01T10:00:00.000Z");
  const first = await service.forceCycle(owner, task.id, "force-task-1-6");
  const repeated = await service.forceCycle(owner, task.id, "force-task-1-6");
  assert.equal(first.grant.priorCount, 6);
  assert.equal(first.grant.newLimit, 7);
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(activities.length, 1);
  assert.deepEqual(activities[0].metadata, { priorCount: 6, newLimit: 7 });
  assert.equal(activities[0].actorId, owner.actor.userId);
  assert.equal(activities[0].taskId, task.id);
});

test("force cycle rejects project members, agents, and tasks without a current limit failure", async () => {
  const cappedTask = { ...task, assigneeId: "agent-1" };
  let limitFailure = true;
  const set = base({
    tasks: { findById: async () => cappedTask } as never,
    runs: { findCycleGrant: async () => null, cycleState: async () => ({ count: 6, limit: 6, limitFailure, failureEventId: limitFailure ? "event-capped" : null }) } as never,
    users: { findById: async () => ({ id: "agent-1", kind: "AGENT" }), getWebhookConfiguration: async () => ({ webhookUrl: "http://127.0.0.1:4500/agents/codex", secretCiphertext: "encrypted", secretVersion: 1 }) } as never,
  });
  const service = new AgentRunApplicationService({ run: async (work) => work(set) });
  await assert.rejects(() => service.forceCycle({ actor: { ...owner.actor, userId: "member-1" } }, task.id, "member-request"), /project owner or administrator/);
  await assert.rejects(() => service.forceCycle(actor, task.id, "agent-request"), /project owner or administrator/);
  limitFailure = false;
  await assert.rejects(() => service.forceCycle(owner, task.id, "not-capped"), /does not have a current cycle-limit failure/);
});
