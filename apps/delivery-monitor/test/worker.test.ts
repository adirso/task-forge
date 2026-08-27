import assert from "node:assert/strict";
import test from "node:test";
import { runSweep } from "../src/worker.js";
import type { MonitorCheckpoint, MonitorLease, MonitorStore } from "../src/persistence.js";

function store(): MonitorStore & { checkpoints: MonitorCheckpoint[]; leases: Set<string> } {
  const value = { checkpoints: [] as MonitorCheckpoint[], leases: new Set<string>() };
  return { ...value, async migrate() {}, async load(runId, taskId, pullRequestUrl) { return value.checkpoints.find(c => c.runId === runId && c.taskId === taskId && c.pullRequestUrl === pullRequestUrl) ?? null; }, async save(c) { value.checkpoints = [c]; }, async acquireLease(runId, ownerId, acquiredAt, expiresAt) { if (value.leases.has(runId)) return null; value.leases.add(runId); return { runId, ownerId, acquiredAt, expiresAt } as MonitorLease; }, async releaseLease(runId) { value.leases.delete(runId); }, async close() {} };
}

test("sweep is bounded, persists checkpoints, and skips an already leased task", async () => {
  const db = store(); let polls = 0;
  const processed = await runSweep({ store: db, ownerId: "worker-1", config: { pollIntervalMs: 60_000, batchSize: 1, leaseDurationMs: 120_000, maxRetries: 5 }, list: async () => [{ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1" }, { runId: "00000000-0000-4000-8000-000000000003", taskId: "00000000-0000-4000-8000-000000000004", pullRequestUrl: "https://github.com/acme/app/pull/2" }], poll: async () => { polls += 1; return { state: "OPEN", observedAt: new Date().toISOString(), etag: "etag-1" }; } });
  assert.equal(processed, 1); assert.equal(polls, 1); assert.equal((await db.load("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "https://github.com/acme/app/pull/1"))?.etag, "etag-1");
});

test("does not retry a checkpoint beyond its configured bound", async () => {
  const db = store();
  await db.save({ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1", cursor: null, etag: null, lastState: "OPEN", observedAt: new Date().toISOString(), retryCount: 2, nextAttemptAt: null, lastError: "NETWORK" });
  let polls = 0;
  const processed = await runSweep({ store: db, ownerId: "worker-1", config: { pollIntervalMs: 60_000, batchSize: 1, leaseDurationMs: 120_000, maxRetries: 2 }, list: async () => [{ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1" }], poll: async () => { polls += 1; return { state: "OPEN", observedAt: new Date().toISOString() }; } });
  assert.equal(processed, 0);
  assert.equal(polls, 0);
});
