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
  await db.acquireLease("00000000-0000-4000-8000-000000000001", "other-worker", new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
  const processed = await runSweep({ store: db, ownerId: "worker-1", config: { pollIntervalMs: 60_000, batchSize: 2, leaseDurationMs: 120_000, maxRetries: 5 }, list: async () => [{ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1" }, { runId: "00000000-0000-4000-8000-000000000003", taskId: "00000000-0000-4000-8000-000000000004", pullRequestUrl: "https://github.com/acme/app/pull/2" }], poll: async () => { polls += 1; return { state: "OPEN", observedAt: new Date().toISOString(), etag: "etag-1" }; } });
  assert.equal(processed, 1); assert.equal(polls, 1); assert.equal((await db.load("00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004", "https://github.com/acme/app/pull/2"))?.etag, "etag-1");
});

test("does not retry a checkpoint beyond its configured bound", async () => {
  const db = store();
  await db.save({ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1", cursor: null, etag: null, lastState: "OPEN", observedAt: new Date().toISOString(), retryCount: 2, nextAttemptAt: null, lastError: "NETWORK" });
  let polls = 0;
  const processed = await runSweep({ store: db, ownerId: "worker-1", config: { pollIntervalMs: 60_000, batchSize: 1, leaseDurationMs: 120_000, maxRetries: 2 }, list: async () => [{ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1" }], poll: async () => { polls += 1; return { state: "OPEN", observedAt: new Date().toISOString() }; } });
  assert.equal(processed, 0);
  assert.equal(polls, 0);
});

test("concurrent sweeps share one lease and callbacks are safe to retry", async () => {
  const db = store();
  const item = { runId: "00000000-0000-4000-8000-000000000005", taskId: "00000000-0000-4000-8000-000000000006", pullRequestUrl: "https://github.com/acme/app/pull/5" };
  let polls = 0;
  const callbacks = new Set<string>();
  let callbackSideEffects = 0;
  const options = (ownerId: string) => ({
    store: db,
    ownerId,
    config: { pollIntervalMs: 60_000, batchSize: 10, leaseDurationMs: 120_000, maxRetries: 3 },
    list: async () => [item],
    poll: async () => { polls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { state: "OPEN", observedAt: new Date().toISOString(), etag: "etag" }; },
    onResult: async (resultItem) => { if (!callbacks.has(resultItem.runId)) { callbacks.add(resultItem.runId); callbackSideEffects += 1; } },
  });
  const [first, second] = await Promise.all([runSweep(options("worker-a")), runSweep(options("worker-b"))]);
  assert.equal(first + second, 1);
  assert.equal(polls, 1);
  assert.equal((await db.load(item.runId, item.taskId, item.pullRequestUrl))?.lastState, "OPEN");
  // A restarted worker sees the same checkpoint and can retry the callback without creating a new run.
  const restarted = await runSweep(options("worker-c"));
  assert.equal(restarted, 1);
  assert.equal(callbacks.size, 1);
  assert.equal(callbackSideEffects, 1);
});

test("poll failures persist bounded retry state and recover on a later sweep", async () => {
  const db = store();
  const item = { runId: "00000000-0000-4000-8000-000000000007", taskId: "00000000-0000-4000-8000-000000000008", pullRequestUrl: "https://github.com/acme/app/pull/7" };
  const errors: string[] = [];
  let fail = true;
  const base = { store: db, ownerId: "worker-a", config: { pollIntervalMs: 60_000, batchSize: 1, leaseDurationMs: 120_000, maxRetries: 3 }, list: async () => [item], onError: (category: any) => errors.push(category) };
  await runSweep({ ...base, poll: async () => { if (fail) throw Object.assign(new Error("rate limited"), { category: "RATE_LIMIT" }); return { state: "OPEN", observedAt: new Date().toISOString() }; } });
  const failed = await db.load(item.runId, item.taskId, item.pullRequestUrl);
  assert.equal(failed?.retryCount, 1);
  assert.equal(failed?.lastError, "RATE_LIMIT");
  fail = false;
  // Clear the backoff in the fixture to model the scheduler reaching nextAttemptAt.
  await db.save({ ...failed!, nextAttemptAt: null });
  await runSweep({ ...base, poll: async () => ({ state: "OPEN", observedAt: new Date().toISOString() }) });
  assert.equal((await db.load(item.runId, item.taskId, item.pullRequestUrl))?.retryCount, 0);
  assert.deepEqual(errors, ["RATE_LIMIT"]);
});
