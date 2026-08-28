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
test("draft PRs and non-approval tasks are not terminally transitioned", async () => {
  let count = 0;
  const draft = await syncTask(base, { fetchPullRequest: async () => ({ state: "DRAFT", headSha: null, etag: null }), updateTask: async () => { count += 1; } });
  const skipped = await syncTask({ ...base, status: "TODO" }, { fetchPullRequest: async () => ({ state: "MERGED", headSha: null, etag: null }), updateTask: async () => { count += 1; } });
  assert.equal(draft.transitionedTo, null); assert.equal(skipped.skipped, true); assert.equal(count, 1);
});
test("terminal transition is rejected when destination is disabled", async () => {
  const result = await syncTask({ ...base, availableStatuses: ["APPROVED", "DONE"] }, { fetchPullRequest: async () => ({ state: "CLOSED", headSha: null, etag: null }), updateTask: async () => { throw new Error("must not update"); } });
  assert.equal(result.errorCategory, "UNKNOWN");
});
test("records redacted operator activity for observations and failures with run correlation", async () => {
  const events: unknown[] = [];
  await syncTask({ ...base, runId: "run-1" }, { fetchPullRequest: async () => ({ state: "OPEN", headSha: null, etag: null }), updateTask: async () => undefined, recordActivity: async (event) => events.push(event) });
  await syncTask({ ...base, runId: "run-1" }, { fetchPullRequest: async () => { const error = new Error("rate limited"); Object.assign(error, { category: "RATE_LIMIT" }); throw error; }, updateTask: async () => undefined, recordActivity: async (event) => events.push(event) });
  assert.deepEqual(events, [{ state: "OPEN", errorCategory: null, runId: "run-1" }, { state: null, errorCategory: "RATE_LIMIT", runId: "run-1" }]);
});
