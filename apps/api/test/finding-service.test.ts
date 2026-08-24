import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskFindingApplicationService } from "../src/application/finding-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

const task = { id: "task-1", projectId: "project-1", status: "IN_REVIEW", creatorId: "owner-1" } as never;
const project = { id: "project-1", ownerId: "owner-1", availableStatuses: ["IN_REVIEW", "FIX_NEEDED", "IN_PROGRESS", "PENDING_DECISION"] } as never;
const owner = { actor: { userId: "owner-1", kind: "HUMAN" as const, role: "MEMBER" as const, name: "Owner", tokenScopes: null } };
const member = { actor: { userId: "member-1", kind: "HUMAN" as const, role: "MEMBER" as const, name: "Member", tokenScopes: null } };

function setup() {
  let finding: any = null; const runs: any[] = []; const activities: any[] = [];
  const set = { users: { findById: async (id: string) => ({ id }) }, projects: { findById: async () => project }, memberships: { isMember: async () => true }, tasks: { findById: async () => task, update: async (_id: string, input: unknown) => ({ ...task, ...input }) },
    findings: { listForTask: async () => finding ? [finding] : [], findById: async () => finding, create: async (input: any) => { finding = input; return input; }, dispose: async (_id: string, disposition: string, actorId: string, reason: string | null, decisionOwnerId: string | null, dueAt: string | null, updatedAt: string) => { if (!finding) return null; finding = { ...finding, disposition, dispositionById: actorId, dispositionReason: reason, decisionOwnerId, dueAt, updatedAt }; return finding; } },
    runs: { findById: async () => null, countForTask: async () => runs.length, create: async (run: any) => { runs.push(run); return run; } }, activity: { record: async (input: any) => { activities.push(input); } },
  } as unknown as RepositorySet;
  return { service: new TaskFindingApplicationService({ run: async (work) => work(set) }, () => "2026-08-24T12:00:00.000Z", () => "00000000-0000-4000-8000-000000000001"), runs, activities, set };
}

test("finding dispositions are audited and FIX_NEEDED creates a new fix run", async () => {
  const { service, runs, activities } = setup();
  const finding = await service.create(owner, task.id, { severity: "P1", title: "Missing guard", body: "The transition is not checked." });
  const updated = await service.dispose(owner, finding.id, { disposition: "FIX_NEEDED", reason: "Must be fixed before approval" });
  assert.equal(updated.disposition, "FIX_NEEDED"); assert.equal(runs[0]?.kind, "FIX"); assert.equal(activities.at(-1)?.action, "task.finding_disposed");
});

test("defer and escalate require an owner and due date, while ordinary members cannot decide another author's finding", async () => {
  const { service } = setup(); const finding = await service.create(owner, task.id, { severity: "P2", title: "Question", body: "Needs a product decision." });
  await assert.rejects(() => service.dispose(owner, finding.id, { disposition: "DEFERRED", reason: "Waiting" }), /decision owner and due date/);
  await assert.rejects(() => service.dispose(member, finding.id, { disposition: "ACCEPTED", reason: "Not relevant" }), /finding author/);
  const deferred = await service.dispose(owner, finding.id, { disposition: "DEFERRED", reason: "Product to decide", decisionOwnerId: "owner-1", dueAt: "2026-08-25T12:00:00.000Z" });
  assert.equal(deferred.disposition, "DEFERRED");
});
