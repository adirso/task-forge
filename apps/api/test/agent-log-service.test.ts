import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentLogApplicationService, type RepositorySet, type RequestContext, type UnitOfWork } from "../src/application/index.js";

const context: RequestContext = { actor: { userId: "agent-1", name: "Smithy", kind: "AGENT", role: "MEMBER", tokenScopes: null } };
const unit = (repositories: Partial<RepositorySet>): UnitOfWork => ({ run: (work) => work(repositories as RepositorySet) });
const task = { id: "task-1", projectId: "project-1" };

test("agent logs redact secrets, validate run ownership, and deduplicate event IDs", async () => {
  const saved: unknown[] = [];
  const repositories = {
    tasks: { findById: async () => task },
    projects: { findById: async () => ({ id: "project-1" }) },
    memberships: { isMember: async () => true },
    runs: { findById: async (id: string) => id === "run-1" ? ({ id: "run-1", taskId: "task-1" }) : null },
    agentLogs: { append: async (log: unknown) => { saved.push(log); return saved.length === 1 ? log : null; }, purgeForTask: async () => 0 },
  };
  const service = new AgentLogApplicationService(unit(repositories), () => "2026-08-25T00:00:00.000Z", () => "log-1");
  const first = await service.append(context, "task-1", { runId: "run-1", provider: "codex", stream: "stderr", category: "output", sequence: 1, eventId: "event:1", content: "Authorization: Bearer tf_private password=hunter2" });
  assert.equal(first.content, "Authorization: Bearer [REDACTED] password=[REDACTED]");
  assert.equal(await service.append(context, "task-1", { runId: "run-1", provider: "codex", stream: "stderr", category: "output", sequence: 1, eventId: "event:1", content: "duplicate" }), null);
  await assert.rejects(() => service.append(context, "task-1", { runId: "other-run", provider: "codex", stream: "stdout", category: "output", sequence: 2, eventId: null, content: "x" }), /runId must reference/);
});
