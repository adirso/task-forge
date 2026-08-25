import assert from "node:assert/strict";
import test from "node:test";
import { formatCountdown, getRunHealth, latestRunLog, runIsWaitingForInput, runLogs } from "../src/lib/runObservability.js";
import type { AgentLog, AgentRun } from "../src/lib/api.js";

const now = Date.parse("2026-08-25T12:00:00.000Z");
const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({ id: "run-1", taskId: "task-1", projectId: "project-1", requestedById: "agent-1", kind: "IMPLEMENTATION", status: "RUNNING", attemptCount: 1, maxAttempts: 3, leaseOwner: "smithy", leaseExpiresAt: "2026-08-25T12:02:00.000Z", heartbeatAt: "2026-08-25T11:59:30.000Z", timeoutAt: "2026-08-25T12:10:00.000Z", lastError: null, createdAt: "2026-08-25T11:58:00.000Z", updatedAt: "2026-08-25T11:59:30.000Z", completedAt: null, ...overrides });
const log = (content: string, sequence: number): AgentLog => ({ id: `log-${sequence}`, taskId: "task-1", runId: "run-1", provider: "codex", stream: "stdout", category: "output", sequence, eventId: null, content, createdAt: `2026-08-25T11:${59 - sequence}:00.000Z` });

test("classifies active and waiting-for-input runs", () => {
  assert.equal(getRunHealth(run(), now).kind, "LIVE");
  assert.equal(getRunHealth(run({ heartbeatAt: "2026-08-25T11:57:00.000Z" }), now).kind, "STALE");
  assert.equal(runIsWaitingForInput(log("Waiting for permission to continue", 1)), true);
});

test("classifies timeout, failure, and completion states", () => {
  assert.equal(getRunHealth(run({ timeoutAt: "2026-08-25T11:59:00.000Z" }), now).kind, "TIMED_OUT");
  assert.equal(getRunHealth(run({ status: "FAILED", lastError: "Provider exited" }), now).kind, "FAILED");
  assert.equal(getRunHealth(run({ status: "SUCCEEDED" }), now).kind, "COMPLETED");
  assert.equal(formatCountdown("2026-08-25T12:01:00.000Z", now), "1m remaining");
});

test("selects the latest provider output for a run", () => {
  assert.equal(latestRunLog([log("first", 1), log("latest", 2)], "run-1")?.content, "latest");
  assert.deepEqual(runLogs([log("first", 1), log("latest", 2)], "run-1").map((item) => item.sequence), [2, 1]);
  assert.equal(latestRunLog([log("other", 1)], "run-2"), null);
});
