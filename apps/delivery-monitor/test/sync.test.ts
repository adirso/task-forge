import assert from "node:assert/strict";
import test from "node:test";
import { syncTask } from "../src/sync.js";

const base = { id: "task-1", status: "APPROVED", approvalStatus: "APPROVED", pullRequestUrl: "https://github.com/acme/app/pull/1", availableStatuses: ["APPROVED", "DONE", "CANCELLED"] };
test("merged and closed PRs transition only from approval", async () => {
  const updates: unknown[] = [];
  const merged = await syncTask(base, { fetchPullRequest: async () => ({ state: "MERGED", headSha: "abc", etag: null }), updateTask: async (patch) => updates.push(patch) });
  assert.equal(merged.transitionedTo, "DONE");
  const closed = await syncTask(base, { fetchPullRequest: async () => ({ state: "CLOSED", headSha: null, etag: null }), updateTask: async (patch) => updates.push(patch) });
  assert.equal(closed.transitionedTo, "CANCELLED");
  assert.equal(updates.length, 2);
});
test("open PRs update metadata without terminal transition", async () => {
  let patch: unknown;
  const result = await syncTask(base, { fetchPullRequest: async () => ({ state: "OPEN", headSha: null, etag: null }), updateTask: async (value) => { patch = value; } });
  assert.equal(result.transitionedTo, null);
  assert.deepEqual(patch, { pullRequestState: "OPEN" });
});
test("terminal transition is rejected when destination is disabled", async () => {
  const result = await syncTask({ ...base, availableStatuses: ["APPROVED", "DONE"] }, { fetchPullRequest: async () => ({ state: "CLOSED", headSha: null, etag: null }), updateTask: async () => { throw new Error("must not update"); } });
  assert.equal(result.errorCategory, "UNKNOWN");
});
