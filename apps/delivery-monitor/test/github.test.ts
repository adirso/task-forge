import assert from "node:assert/strict";
import test from "node:test";
import { fetchGithubPullRequest, GithubMonitorError } from "../src/github.js";

const response = (status: number, body: unknown, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), { status, headers });
test("maps GitHub merged, closed, draft and open responses", async () => {
  const run = (body: unknown) => fetchGithubPullRequest("https://github.com/acme/app/pull/1", undefined, async () => response(200, body));
  assert.equal((await run({ state: "closed", merged_at: "now", draft: false })).state, "MERGED");
  assert.equal((await run({ state: "closed", merged_at: null, draft: false })).state, "CLOSED");
  assert.equal((await run({ state: "open", merged_at: null, draft: true })).state, "DRAFT");
});
test("maps GitHub failures to redacted categories", async () => {
  for (const [status, category] of [[401,"AUTHENTICATION"],[403,"PERMISSION"],[429,"RATE_LIMIT"],[404,"NOT_FOUND"]] as const) await assert.rejects(() => fetchGithubPullRequest("https://github.com/acme/app/pull/1", undefined, async () => response(status, {})), (error: GithubMonitorError) => error.category === category && !error.message.includes("token"));
});
