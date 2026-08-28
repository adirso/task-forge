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
    await store.close();
    const restarted = new SqliteMonitorStore(join(dir, "monitor.db"));
    assert.equal((await restarted.load(ids.runId, ids.taskId, ids.pullRequestUrl))?.etag, "e1");
    await restarted.close();
    const now = new Date().toISOString();
    const active = new SqliteMonitorStore(join(dir, "monitor.db"));
    assert.ok(await active.acquireLease(ids.runId, "worker-a", now, new Date(Date.now() + 1000).toISOString()));
    assert.equal(await active.acquireLease(ids.runId, "worker-b", now, new Date(Date.now() + 1000).toISOString()), null);
    assert.ok(await active.acquireLease(ids.runId, "worker-b", new Date(Date.now() + 2000).toISOString(), new Date(Date.now() + 3000).toISOString()));
    await active.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
