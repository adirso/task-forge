import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskGateApplicationService } from "../src/application/gate-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

const task = { id: "task-1", projectId: "project-1", creatorId: "owner-1", status: "IN_REVIEW", pullRequestState: "OPEN" } as never;
const project = { id: "project-1", ownerId: "owner-1", availableStatuses: ["IN_REVIEW", "READY_FOR_REVIEW"] } as never;
function setup() {
  let gate: any = null;
  const set = { projects: { findById: async () => project }, memberships: { isMember: async () => true }, tasks: { findById: async () => task, update: async (_id: string, input: unknown) => ({ ...task, ...input }) }, activity: { record: async () => undefined }, gates: {
    findByTask: async () => gate,
    save: async (input: any) => { gate = input; return input; },
    approve: async (_id: string, headSha: string, actorId: string, now: string) => { if (!gate || gate.headSha !== headSha) return null; gate = { ...gate, approvedHeadSha: headSha, approvedById: actorId, approvedAt: now }; return gate; },
    merge: async (_id: string, headSha: string, actorId: string, now: string) => { if (!gate || gate.headSha !== headSha || gate.approvedHeadSha !== headSha) return null; gate = { ...gate, mergedHeadSha: headSha, mergedById: actorId, mergedAt: now }; return gate; },
  } } as unknown as RepositorySet;
  return { set, service: new TaskGateApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T12:00:00.000Z") };
}

const human = { actor: { userId: "owner-1", kind: "HUMAN" as const, role: "ADMIN" as const, name: "Owner", tokenScopes: null } };
const codex = { actor: { userId: "codex-1", kind: "AGENT" as const, role: "MEMBER" as const, name: "Review Agent", tokenScopes: ["task:gate:approve"] as const } };

test("head changes invalidate prior approval and only matching checks can approve", async () => {
  const { service } = setup();
  await service.record(human, task.id, { headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] });
  await service.approve(codex, task.id, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await service.record(human, task.id, { headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }] });
  await assert.rejects(() => service.merge(human, task.id, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), /Codex approval/);
});

test("merge requires Codex approval and human authorization, then records merged evidence", async () => {
  const { service } = setup(); const head = "cccccccccccccccccccccccccccccccccccccccc";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality", "MySQL"], checks: [{ name: "Quality", status: "PASS", headSha: head }, { name: "MySQL", status: "PASS", headSha: head }] });
  await assert.rejects(() => service.approve(human, task.id, head), /task:gate:approve/);
  await service.approve(codex, task.id, head);
  const merged = await service.merge(human, task.id, head);
  assert.equal(merged.mergedHeadSha, head);
});

test("gate evidence requires configured checks and every check to pass before approval", async () => {
  const { service } = setup();
  const head = "dddddddddddddddddddddddddddddddddddddddd";
  await assert.rejects(() => service.record(human, task.id, { headSha: head, requiredChecks: [], checks: [] }), /At least one required/);
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "FAIL", headSha: head }] });
  await assert.rejects(() => service.approve(codex, task.id, head), /not passing/);
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PENDING", headSha: head }] });
  await assert.rejects(() => service.approve(codex, task.id, head), /not passing/);
});

test("ordinary project members cannot fabricate gate evidence", async () => {
  const { service } = setup();
  const member = { actor: { userId: "member-1", kind: "HUMAN" as const, role: "MEMBER" as const, name: "Member", tokenScopes: null } };
  await assert.rejects(() => service.record(member, task.id, { headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }] }), /authorized CI agent/);
});
