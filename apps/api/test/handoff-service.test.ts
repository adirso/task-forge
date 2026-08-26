import assert from "node:assert/strict";
import test from "node:test";
import { AgentHandoffApplicationService } from "../src/application/handoff-service.js";
import type { RepositorySet, UnitOfWork } from "../src/application/repositories.js";

const run = { id: "run-1", taskId: "task-1", projectId: "project-1", status: "RUNNING", leaseOwner: "agent-1" } as never;
const project = { id: "project-1", ownerId: "owner-1" } as never;
const context = { actor: { userId: "agent-1", kind: "AGENT", role: "MEMBER", tokenScopes: null } } as never;

test("handoff checkpoints are idempotent and validate publication evidence", async () => {
  let saved: any = null;
  const repositories = { runs: { findById: async () => run }, projects: { findById: async () => project }, memberships: { isMember: async () => true }, handoffs: { findByRun: async () => saved, save: async (value: any) => (saved = value) } } as unknown as RepositorySet;
  const unit: UnitOfWork = { run: async (work) => work(repositories) };
  const service = new AgentHandoffApplicationService(unit, () => "2026-08-26T00:00:00.000Z");
  await assert.rejects(() => service.validate(context, "run-1"), /Review handoff requires/);
  const input = { branch: "agent/task", headSha: "a".repeat(40), branchPublished: true, pullRequestUrl: "https://github.com/example/repo/pull/1", pullRequestTitle: "Implement task", pullRequestState: "OPEN" as const, status: "PUBLISHED" as const, lastError: null };
  const first = await service.save(context, "run-1", input);
  const second = await service.save(context, "run-1", input);
  assert.equal(first.runId, second.runId);
  assert.equal((await service.validate(context, "run-1")).headSha, "a".repeat(40));
});

test("incomplete handoffs remain pending and redact diagnostic secrets", async () => {
  let saved: any = null;
  const repositories = { runs: { findById: async () => run }, projects: { findById: async () => project }, memberships: { isMember: async () => true }, handoffs: { findByRun: async () => saved, save: async (value: any) => (saved = value) } } as unknown as RepositorySet;
  const unit: UnitOfWork = { run: async (work) => work(repositories) };
  const service = new AgentHandoffApplicationService(unit);
  const result = await service.save(context, "run-1", { branch: "agent/task", headSha: null, branchPublished: false, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, status: "FAILED", lastError: "Authorization: Bearer tf_secret-value" });
  assert.equal(result.status, "FAILED");
  assert.match(result.lastError ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(result.lastError ?? "", /tf_secret-value/);
});

test("stale agent cannot overwrite a handoff after lease ownership changes", async () => {
  const repositories = { runs: { findById: async () => ({ ...run, leaseOwner: "new-agent" }) }, projects: { findById: async () => project }, memberships: { isMember: async () => true }, handoffs: { findByRun: async () => null, save: async (value: any) => value } } as unknown as RepositorySet;
  const unit: UnitOfWork = { run: async (work) => work(repositories) };
  const service = new AgentHandoffApplicationService(unit);
  await assert.rejects(() => service.save(context, "run-1", { branch: "agent/task", headSha: null, branchPublished: false, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, status: "PENDING", lastError: null }), /lease is not owned/);
});
