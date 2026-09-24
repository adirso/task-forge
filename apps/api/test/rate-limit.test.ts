import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("distinct login account keys cannot exceed the in-process capacity", () => {
  const limiter = new RateLimiter(60_000, 1, 60_000, 32, 1);
  for (let i = 0; i < 100; i += 1) limiter.failure(`login:account:user-${i}@example.test`, 0);

  assert.equal(limiter.check("login:account:user-0@example.test", 1).allowed, false);
  assert.equal(limiter.check("login:account:overflow@example.test", 1).allowed, false, "new keys fail closed when the bounded store is full");
  assert.equal(limiter.check("login:ip:198.51.100.7", 1).allowed, false, "the configured key type cannot bypass capacity enforcement");
});

test("expired keys are reclaimed and capacity becomes available", () => {
  const limiter = new RateLimiter(100, 1, 1_000, 3, 2);
  for (let i = 0; i < 3; i += 1) limiter.failure(`login:account:user-${i}@example.test`, 0);
  assert.equal(limiter.check("login:account:new@example.test", 1).allowed, false);

  assert.equal(limiter.check("login:account:new@example.test", 100).allowed, false, "capacity remains closed until the bounded periodic sweep runs");
  assert.equal(limiter.check("login:account:new@example.test", 100).allowed, true);
});

test("shared ingress configuration rate-limits login by client IP across API workers", async () => {
  const httpConfig = await readFile(new URL("../../../deploy/nginx/taskforge-rate-limit.http.conf", import.meta.url), "utf8");
  const serverConfig = await readFile(new URL("../../../deploy/nginx/taskforge-rate-limit.server.conf", import.meta.url), "utf8");
  assert.match(httpConfig, /limit_req_zone\s+\$binary_remote_addr\s+zone=taskforge_login_by_ip:10m\s+rate=20r\/m;/);
  assert.match(serverConfig, /location\s*=\s*\/api\/auth\/login\s*\{/);
  assert.match(serverConfig, /limit_req\s+zone=taskforge_login_by_ip\s+burst=5\s+nodelay;/);
  assert.match(serverConfig, /limit_req_status\s+429;/);
  assert.match(serverConfig, /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for;/);
});
