import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter } from "../src/lib/rate-limit.js";

test("rate limiter backs off at the threshold and resets after the window", () => {
  const limiter = new RateLimiter(100, 2, 1_000);
  limiter.failure("client", 0);
  assert.equal(limiter.check("client", 0).allowed, true);
  limiter.failure("client", 1);
  const blocked = limiter.check("client", 2);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.check("client", 101).allowed, true);
});

test("successful authentication clears a client counter", () => {
  const limiter = new RateLimiter(60_000, 1, 60_000);
  limiter.failure("client", 0);
  assert.equal(limiter.check("client", 1).allowed, false);
  limiter.success("client");
  assert.equal(limiter.check("client", 2).allowed, true);
});
