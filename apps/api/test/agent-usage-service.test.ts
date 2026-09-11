import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentUsageApplicationService, assertAgentBudgetAllows, exceededLimits } from "../src/application/agent-usage-service.js";
import type { RepositorySet } from "../src/application/repositories.js";
import type { AgentRunEntity, ProjectEntity, TaskEntity } from "../src/application/models.js";

const project = { id: "project-1", ownerId: "owner-1" } as ProjectEntity;
const task = { id: "task-1", projectId: project.id, phaseId: "phase-1" } as TaskEntity;
const run = { id: "run-1", taskId: task.id, projectId: project.id, status: "RUNNING", controlState: "ACTIVE", leaseOwner: "agent-1", attemptCount: 2, controlVersion: 4 } as AgentRunEntity;
const actor = { actor: { userId: "agent-1", name: "Agent", kind: "AGENT" as const, role: "MEMBER" as const, tokenScopes: null } };

test("usage accounting derives retries and forced cycles and pauses through optimistic run control", async () => {
  let recorded: any; let paused: any; const activity: any[] = [];
  const repositories = {
    runs: { findById: async () => run, cycleState: async () => ({ count: 7, limit: 7, limitFailure: false, failureEventId: null }), applyIntervention: async (...args: unknown[]) => { paused = args; return true; } },
    tasks: { findById: async () => task }, projects: { findById: async () => project }, memberships: { isMember: async () => true },
    agentUsage: { append: async (event: any) => { recorded = event; return { event, created: true }; }, totals: async () => ({ inputTokens: 8, outputTokens: 4, totalTokens: 12, costMicros: 0, toolCalls: 0, runtimeMs: 0, retries: 1, forcedCycles: 1, runCount: 1, eventCount: 1 }) },
    agentBudgets: { listApplicable: async () => [{ id: "budget-1", projectId: project.id, scope: "TASK", scopeId: task.id, action: "PAUSE", limits: { totalTokens: 10 } }] },
    tokens: { revokeRunCredential: async () => undefined },
    activity: { record: async (entry: any) => { activity.push(entry); } },
  } as unknown as RepositorySet;
  const service = new AgentUsageApplicationService({ run: async (work) => work(repositories) }, () => "2026-09-10T00:00:00.000Z", () => "usage-1");
  const result = await service.record(actor, run.id, { eventId: "attempt-2", provider: "fake", model: "fixture", inputTokens: 8, outputTokens: 4, costMicros: 0, toolCalls: 0, runtimeMs: 50 });
  assert.equal(recorded.retry, true);
  assert.equal(recorded.forcedCycle, true);
  assert.deepEqual(paused?.slice(0, 2), [run.id, run.controlVersion]);
  assert.equal(result.budgetDecisions[0]?.action, "PAUSE");
  assert.equal(activity[0]?.action, "agent_usage.budget_pause");
});

test("budget comparison is deterministic and warn budgets do not block new work", async () => {
  assert.deepEqual(exceededLimits({ inputTokens: 4, outputTokens: 6, totalTokens: 10, costMicros: 2, toolCalls: 1, runtimeMs: 50, retries: 0, forcedCycles: 0, runCount: 1, eventCount: 1 }, { totalTokens: 10, costMicros: 3 }), ["totalTokens"]);
  const repositories = { agentBudgets: { listApplicable: async () => [{ action: "WARN", limits: { totalTokens: 1 } }] }, agentUsage: { totals: async () => ({ totalTokens: 100 }) } } as unknown as RepositorySet;
  await assert.doesNotReject(() => assertAgentBudgetAllows(repositories, task));
});
