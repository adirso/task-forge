import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskGateApplicationService } from "../src/application/gate-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

const task = { id: "task-1", projectId: "project-1", creatorId: "owner-1", status: "IN_REVIEW", pullRequestState: "OPEN" } as never;
const project = { id: "project-1", ownerId: "owner-1", availableStatuses: ["IN_REVIEW", "READY_FOR_REVIEW"], reviewPolicy: { requireIndependentReview: false, requiredReviewerCount: 1, allowedReviewerAgentIds: [] as string[] } };
function setup(reviewPolicy = project.reviewPolicy) {
  let gate: any = null; const findings: any[] = []; const artifacts: any[] = [];
  const implementationRun = { id: "run-1", executedById: "implementer-1" };
  const set = { projects: { findById: async () => ({ ...project, reviewPolicy }) }, memberships: { isMember: async () => true }, users: { findById: async (id: string) => ({ id, kind: "AGENT" }) }, tasks: { findById: async () => task, update: async (_id: string, input: unknown) => ({ ...task, ...input }) }, handoffs: { findPublishedByTaskHead: async () => ({ runId: "run-1" }) }, runs: { findById: async () => implementationRun }, findings: { listForTask: async () => findings }, artifacts: { listForTask: async (_taskId: string, headSha?: string) => artifacts.filter((artifact) => !headSha || artifact.headSha === headSha) }, activity: { record: async () => undefined }, gates: {
    findByTask: async () => gate,
    save: async (input: any) => { gate = input; return input; },
    approve: async (_id: string, headSha: string, actorId: string, approvalPolicy: { requiredReviewerCount: number; excludedReviewerId: string | null; allowedReviewerIds: string[] }, now: string) => { if (!gate || gate.headSha !== headSha) return null; const approvals = gate.approvals.some((item: any) => item.reviewerId === actorId) ? gate.approvals : [...gate.approvals, { reviewerId: actorId, approvedAt: now }]; const eligible = approvals.filter((item: any) => (!approvalPolicy.excludedReviewerId || item.reviewerId !== approvalPolicy.excludedReviewerId) && (!approvalPolicy.allowedReviewerIds.length || approvalPolicy.allowedReviewerIds.includes(item.reviewerId))); gate = { ...gate, approvals, approvedHeadSha: eligible.length >= approvalPolicy.requiredReviewerCount ? headSha : null, approvedById: eligible.length >= approvalPolicy.requiredReviewerCount ? actorId : null, approvedAt: eligible.length >= approvalPolicy.requiredReviewerCount ? now : null }; return gate; },
    merge: async (_id: string, headSha: string, actorId: string, now: string) => { if (!gate || gate.headSha !== headSha || gate.approvedHeadSha !== headSha) return null; gate = { ...gate, mergedHeadSha: headSha, mergedById: actorId, mergedAt: now }; return gate; },
  } } as unknown as RepositorySet;
  return { set, findings, artifacts, service: new TaskGateApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T12:00:00.000Z") };
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

test("gate approval requires configured artifact types for the current head", async () => {
  const { service, artifacts } = setup(); const head = "abababababababababababababababababababab";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], requiredArtifactTypes: ["TEST_RESULT", "COMMIT"], checks: [{ name: "Quality", status: "PASS", headSha: head }] });
  artifacts.push({ type: "TEST_RESULT", headSha: head });
  await assert.rejects(() => service.approve(codex, task.id, head), /COMMIT/);
  artifacts.push({ type: "COMMIT", headSha: head });
  const approved = await service.approve(codex, task.id, head);
  assert.equal(approved.approvedHeadSha, head);
});

test("ordinary project members cannot fabricate gate evidence", async () => {
  const { service } = setup();
  const member = { actor: { userId: "member-1", kind: "HUMAN" as const, role: "MEMBER" as const, name: "Member", tokenScopes: null } };
  await assert.rejects(() => service.record(member, task.id, { headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }] }), /authorized CI agent/);
});

test("approval is blocked by unresolved P1 findings", async () => {
  const { service, findings } = setup(); const head = "ffffffffffffffffffffffffffffffffffffffff";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: head }] });
  findings.push({ id: "finding-1", severity: "P1", disposition: "OPEN" });
  await assert.rejects(() => service.approve(codex, task.id, head), /Blocking review findings/);
  findings[0].disposition = "ACCEPTED";
  await service.approve(codex, task.id, head);
});

test("independent review denies self-review, enforces allowed reviewers and quorum", async () => {
  const policy = { requireIndependentReview: true, requiredReviewerCount: 2, allowedReviewerAgentIds: ["implementer-1", "codex-1", "codex-2"] };
  const { service } = setup(policy); const head = "1111111111111111111111111111111111111111";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: head }] });
  const implementer = { actor: { ...codex.actor, userId: "implementer-1" } };
  await assert.rejects(() => service.approve(implementer, task.id, head), /cannot approve its own work/);
  const unauthorized = { actor: { ...codex.actor, userId: "codex-3" } };
  await assert.rejects(() => service.approve(unauthorized, task.id, head), /not allowed/);
  const first = await service.approve(codex, task.id, head);
  assert.equal(first.approvedHeadSha, null);
  const second = await service.approve({ actor: { ...codex.actor, userId: "codex-2" } }, task.id, head);
  assert.equal(second.approvedHeadSha, head);
  assert.equal(second.approvals.length, 2);
});

test("merge revalidates the current project review policy", async () => {
  const policy = { requireIndependentReview: true, requiredReviewerCount: 1, allowedReviewerAgentIds: ["codex-1", "codex-2"] };
  const { service } = setup(policy); const head = "2222222222222222222222222222222222222222";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: head }] });
  await service.approve(codex, task.id, head);
  policy.requiredReviewerCount = 2;
  await assert.rejects(() => service.merge(human, task.id, head), /requires 2 eligible agent approval/);
});

test("approval quorum ignores reviewers that become ineligible", async () => {
  const policy = { requireIndependentReview: false, requiredReviewerCount: 1, allowedReviewerAgentIds: [] as string[] };
  const { service } = setup(policy); const head = "3333333333333333333333333333333333333333";
  await service.record(human, task.id, { headSha: head, requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: head }] });
  const initiallyApproved = await service.approve(codex, task.id, head);
  assert.equal(initiallyApproved.approvedHeadSha, head);
  policy.requiredReviewerCount = 2;
  policy.allowedReviewerAgentIds = ["codex-2", "codex-3"];
  const oneEligibleReviewer = await service.approve({ actor: { ...codex.actor, userId: "codex-2" } }, task.id, head);
  assert.equal(oneEligibleReviewer.approvedHeadSha, null);
  const quorum = await service.approve({ actor: { ...codex.actor, userId: "codex-3" } }, task.id, head);
  assert.equal(quorum.approvedHeadSha, head);
});
