import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AgentArtifactApplicationService, MAX_AGENT_ARTIFACTS_PER_RUN } from "../src/application/artifact-service.js";
import type { RepositorySet } from "../src/application/repositories.js";

const run = { id: "run-1", taskId: "task-1", projectId: "project-1", status: "RUNNING", controlState: "ACTIVE", leaseOwner: "agent-1" };
const task = { id: "task-1", projectId: "project-1" };
const context = { actor: { userId: "agent-1", kind: "AGENT" as const, role: "MEMBER" as const, name: "Builder", tokenScopes: ["task:artifact"] as const } };

function setup(member = true) {
  const artifacts: any[] = []; const activity: any[] = [];
  const repositories = {
    runs: { findById: async () => run }, tasks: { findById: async () => task }, projects: { findById: async () => ({ id: "project-1", ownerId: "owner-1" }) }, memberships: { isMember: async () => member },
    artifacts: {
      lockRun: async () => undefined, countForRun: async () => artifacts.length,
      findDuplicate: async (runId: string, type: string, headSha: string, contentHash: string) => artifacts.find((item) => item.runId === runId && item.type === type && item.headSha === headSha && item.contentHash === contentHash) ?? null,
      create: async (input: any) => { const duplicate = artifacts.find((item) => item.runId === input.runId && item.type === input.type && item.headSha === input.headSha && item.contentHash === input.contentHash); if (duplicate) return duplicate; artifacts.push(input); return input; },
      findById: async (id: string) => artifacts.find((item) => item.id === id) ?? null, listForRun: async () => artifacts, listForTask: async () => artifacts,
    },
    activity: { record: async (input: any) => { activity.push(input); } },
  } as unknown as RepositorySet;
  return { service: new AgentArtifactApplicationService({ run: async (work) => work(repositories) }, () => "2026-09-10T12:00:00.000Z", () => `artifact-${artifacts.length + 1}`), artifacts, activity };
}

test("artifacts are immutable, content-addressed, redacted, and idempotent", async () => {
  const { service, artifacts, activity } = setup();
  const raw = Buffer.from('{"result":"PASS","token":"tf_private"}');
  const input = { type: "TEST_RESULT" as const, name: "Tests token=tf_name", headSha: "a".repeat(40), mediaType: "application/json", data: raw.toString("base64"), payloadSha256: createHash("sha256").update(raw).digest("hex"), metadata: { command: "TOKEN=tf_command npm test", status: "PASS" as const, summary: "Authorization: Bearer tf_summary" } };
  const first = await service.create(context, run.id, input);
  const duplicate = await service.create(context, run.id, input);
  assert.equal(first.created, true); assert.equal(duplicate.created, false); assert.equal(duplicate.artifact.id, first.artifact.id); assert.equal(artifacts.length, 1); assert.equal(activity.length, 1);
  assert.doesNotMatch(first.artifact.content.toString("utf8"), /tf_private/); assert.doesNotMatch(JSON.stringify(first.artifact.metadata), /tf_command|tf_summary/); assert.doesNotMatch(first.artifact.name, /tf_name/);
  assert.equal(first.artifact.contentHash, createHash("sha256").update(first.artifact.content).digest("hex"));
});

test("artifact integrity, authorization, and retention limits fail closed", async () => {
  const { service, artifacts } = setup();
  const input = { type: "COMMIT" as const, name: "Commit", headSha: "b".repeat(40), mediaType: "application/json", data: Buffer.from("{}").toString("base64"), payloadSha256: "c".repeat(64), metadata: { sha: "b".repeat(40) } };
  await assert.rejects(() => service.create(context, run.id, input), /checksum/);
  await assert.rejects(() => setup(false).service.create(context, run.id, { ...input, payloadSha256: undefined }), /not a member/);
  await assert.rejects(() => setup(false).service.listForTask(context, task.id), /not a member/);
  artifacts.push(...Array.from({ length: MAX_AGENT_ARTIFACTS_PER_RUN }, (_, index) => ({ id: `existing-${index}` })));
  await assert.rejects(() => service.create(context, run.id, { ...input, payloadSha256: undefined }), /retain at most/);
});
