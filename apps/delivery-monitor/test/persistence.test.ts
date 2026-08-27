import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteMonitorStore } from "../src/persistence.js";

const ids = { runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000002", pullRequestUrl: "https://github.com/acme/app/pull/1" };

test("SQLite store persists checkpoints and reclaims expired leases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "delivery-monitor-"));
  const store = new SqliteMonitorStore(join(dir, "monitor.db"));
  try {
    await store.migrate();
    await store.save({ ...ids, cursor: "c1", etag: "e1", lastState: "OPEN", observedAt: new Date().toISOString(), retryCount: 0, nextAttemptAt: null, lastError: null });
    assert.equal((await store.load(ids.runId, ids.taskId, ids.pullRequestUrl))?.etag, "e1");
    const now = new Date().toISOString();
    assert.ok(await store.acquireLease(ids.runId, "worker-a", now, new Date(Date.now() + 1000).toISOString()));
    assert.equal(await store.acquireLease(ids.runId, "worker-b", now, new Date(Date.now() + 1000).toISOString()), null);
    assert.ok(await store.acquireLease(ids.runId, "worker-b", new Date(Date.now() + 2000).toISOString(), new Date(Date.now() + 3000).toISOString()));
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
