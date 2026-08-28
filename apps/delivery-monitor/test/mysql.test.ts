import test from "node:test";
import assert from "node:assert/strict";
import { MysqlMonitorStore } from "../src/persistence.js";

test("MySQL store persists a checkpoint and lease when configured", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const store = new MysqlMonitorStore(process.env.TEST_DATABASE_URL!);
  const ids = { runId: "00000000-0000-4000-8000-000000000011", taskId: "00000000-0000-4000-8000-000000000012", pullRequestUrl: "https://github.com/acme/app/pull/11" };
  try {
    await store.migrate();
    await store.save({ ...ids, cursor: null, etag: "etag", lastState: "OPEN", observedAt: new Date().toISOString(), retryCount: 0, nextAttemptAt: null, lastError: null });
    assert.equal((await store.load(ids.runId, ids.taskId, ids.pullRequestUrl))?.etag, "etag");
    assert.ok(await store.acquireLease(ids.runId, "mysql-test", new Date().toISOString(), new Date(Date.now() + 1000).toISOString()));
  } finally { await store.close(); }
});
