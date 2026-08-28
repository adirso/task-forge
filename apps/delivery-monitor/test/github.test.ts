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

test("rejects unsupported URLs before making a network request", async () => {
  let called = false;
  await assert.rejects(
    () => fetchGithubPullRequest("https://github.com/acme/app/issues/42", undefined, async () => { called = true; return response(200, {}); }),
    (error: GithubMonitorError) => error.category === "INVALID_URL" && /supported GitHub URL/.test(error.message),
  );
  assert.equal(called, false);
});

test("classifies timeout and transport failures without leaking provider details", async () => {
  const timeout = new Error("request exceeded 30s");
  timeout.name = "TimeoutError";
  await assert.rejects(
    () => fetchGithubPullRequest("https://github.com/acme/app/pull/1", "secret-token", async () => { throw timeout; }),
    (error: GithubMonitorError) => error.category === "TIMEOUT" && !error.message.includes("secret-token"),
  );
  await assert.rejects(
    () => fetchGithubPullRequest("https://github.com/acme/app/pull/1", "secret-token", async () => { throw new Error("socket secret-token"); }),
    (error: GithubMonitorError) => error.category === "NETWORK" && !error.message.includes("secret-token"),
  );
});

test("sends ETags for conditional observations and preserves them on 304", async () => {
  let requestHeaders: Headers | undefined;
  const result = await fetchGithubPullRequest("https://github.com/acme/app/pull/1", undefined, async (_url, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(null, { status: 304, headers: { etag: "etag-next" } });
  }, "etag-prev");
  assert.equal(requestHeaders?.get("if-none-match"), "etag-prev");
  assert.deepEqual(result, { state: "OPEN", headSha: null, etag: "etag-next" });
});
