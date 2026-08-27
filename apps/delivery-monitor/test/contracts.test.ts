import assert from "node:assert/strict";
import test from "node:test";
import { deliveryMonitorConfigSchema, mapGithubPullRequestState, parseDeliveryMonitorPullRequestUrl } from "@taskforge/contracts";

test("accepts canonical GitHub pull request URLs only", () => {
  assert.deepEqual(parseDeliveryMonitorPullRequestUrl("https://github.com/acme/app/pull/42"), { owner: "acme", repository: "app", number: 42, url: "https://github.com/acme/app/pull/42" });
  assert.equal(parseDeliveryMonitorPullRequestUrl("https://gitlab.com/acme/app/pull/42"), null);
  assert.equal(parseDeliveryMonitorPullRequestUrl("https://github.com/acme/app/issues/42"), null);
  assert.equal(parseDeliveryMonitorPullRequestUrl("https://github.com/acme/app/pull/0"), null);
});

test("maps GitHub state with merged taking precedence", () => {
  assert.equal(mapGithubPullRequestState("open", null), "OPEN");
  assert.equal(mapGithubPullRequestState("open", null, true), "DRAFT");
  assert.equal(mapGithubPullRequestState("closed", null), "CLOSED");
  assert.equal(mapGithubPullRequestState("closed", "2026-01-01T00:00:00Z"), "MERGED");
});

test("provides safe defaults and rejects partial GitHub App credentials", () => {
  const config = deliveryMonitorConfigSchema.parse({});
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.batchSize, 100);
  assert.throws(() => deliveryMonitorConfigSchema.parse({ githubAppId: "123" }), /configured together/);
});
