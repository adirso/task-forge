import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepositorySet, UnitOfWork } from "../src/application/repositories.js";
import type { WebhookDeliveryEntity } from "../src/application/models.js";
import { WebhookDispatcher, verifyWebhookSignature } from "../src/lib/webhook.js";

const secret = "whsec_test_signing_secret";

function delivery(): WebhookDeliveryEntity {
  const createdAt = "2026-08-23T10:00:00.000Z";
  return {
    id: "event-1", agentId: "agent-1", taskId: "task-1", eventType: "task.update_added",
    payload: JSON.stringify({ id: "event-1", event: "task.update_added", credential: "payload-secret" }),
    status: "PENDING", attemptCount: 0, nextAttemptAt: createdAt, lockedUntil: null,
    lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null,
    createdAt, updatedAt: createdAt,
  };
}

function harness(input: { fetch: typeof fetch; maxAttempts?: number; timeoutMs?: number }) {
  let current = new Date("2026-08-23T10:00:00.000Z");
  let state = delivery();
  const logs: Record<string, unknown>[] = [];
  const repositories = {
    users: { getWebhookConfiguration: async () => ({ webhookUrl: "https://agent.example/webhook?token=url-secret", secretCiphertext: "encrypted-secret", secretVersion: 3 }) },
    webhookDeliveries: {
      listDue: async (now: string) => state.status !== "DELIVERED" && state.status !== "FAILED" && state.nextAttemptAt <= now && (!state.lockedUntil || state.lockedUntil <= now) ? [state.id] : [],
      claim: async (id: string, now: string, lockedUntil: string) => {
        if (id !== state.id || state.status === "DELIVERED" || state.status === "FAILED" || state.nextAttemptAt > now || (state.lockedUntil && state.lockedUntil > now)) return false;
        state = { ...state, attemptCount: state.attemptCount + 1, lastAttemptAt: now, lockedUntil, updatedAt: now };
        return true;
      },
      findById: async () => ({ ...state }),
      markDelivered: async (_id: string, deliveredAt: string, httpStatus: number) => { state = { ...state, status: "DELIVERED", deliveredAt, httpStatus, lockedUntil: null, lastError: null, updatedAt: deliveredAt }; },
      markRetry: async (_id: string, nextAttemptAt: string, lastError: string, httpStatus: number | null, updatedAt: string) => { state = { ...state, status: "RETRYING", nextAttemptAt, lastError, httpStatus, lockedUntil: null, updatedAt }; },
      markFailed: async (_id: string, failedAt: string, lastError: string, httpStatus: number | null) => { state = { ...state, status: "FAILED", failedAt, lastError, httpStatus, lockedUntil: null, updatedAt: failedAt }; },
    },
  } as unknown as RepositorySet;
  const unitOfWork: UnitOfWork = { run: (work) => work(repositories) };
  const dispatcher = new WebhookDispatcher(unitOfWork, () => secret, {
    fetch: input.fetch, now: () => new Date(current), maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs ?? 50, retryBaseMs: 1_000, retryMaxMs: 4_000,
    logger: { info: (details) => logs.push(details), warn: (details) => logs.push(details) },
  });
  return { dispatcher, state: () => state, logs, advance(milliseconds: number) { current = new Date(current.getTime() + milliseconds); } };
}

test("dispatcher signs successful deliveries and claims an event only once", async () => {
  const requests: Array<{ body: string; headers: Headers }> = [];
  const fixture = harness({ fetch: async (_url, init) => {
    requests.push({ body: String(init?.body), headers: new Headers(init?.headers) });
    return new Response(null, { status: 204 });
  } });

  await Promise.all([fixture.dispatcher.tick(), fixture.dispatcher.tick()]);

  assert.equal(requests.length, 1);
  assert.equal(fixture.state().status, "DELIVERED");
  assert.equal(fixture.state().attemptCount, 1);
  const request = requests[0]!;
  assert.equal(request.headers.get("idempotency-key"), "event-1");
  assert.equal(request.headers.get("x-taskforge-event-id"), "event-1");
  assert.equal(request.headers.get("x-taskforge-delivery-attempt"), "1");
  assert.equal(request.headers.get("x-taskforge-secret-version"), "3");
  const signatureHeader = request.headers.get("x-taskforge-signature")!;
  const timestamp = Number(signatureHeader.match(/^t=(\d+),/)?.[1]);
  const signature = signatureHeader.match(/v1=([a-f0-9]{64})$/)?.[1] ?? "";
  assert.equal(verifyWebhookSignature(secret, timestamp, request.body, signature), true);
});

test("non-2xx responses retry exponentially with one stable idempotency key", async () => {
  const attempts: Array<{ key: string | null; body: string }> = [];
  const fixture = harness({ maxAttempts: 3, fetch: async (_url, init) => {
    attempts.push({ key: new Headers(init?.headers).get("idempotency-key"), body: String(init?.body) });
    return new Response(null, { status: attempts.length < 3 ? 503 : 202 });
  } });

  await fixture.dispatcher.tick();
  assert.equal(fixture.state().status, "RETRYING");
  assert.equal(fixture.state().nextAttemptAt, "2026-08-23T10:00:01.000Z");
  fixture.advance(1_000);
  await fixture.dispatcher.tick();
  assert.equal(fixture.state().nextAttemptAt, "2026-08-23T10:00:03.000Z");
  fixture.advance(2_000);
  await fixture.dispatcher.tick();

  assert.equal(fixture.state().status, "DELIVERED");
  assert.equal(fixture.state().attemptCount, 3);
  assert.deepEqual(new Set(attempts.map(({ key }) => key)), new Set(["event-1"]));
  assert.deepEqual(new Set(attempts.map(({ body }) => body)), new Set([delivery().payload]));
});

test("network errors reach a bounded terminal failure without logging credentials", async () => {
  const fixture = harness({ maxAttempts: 2, fetch: async () => { throw new Error(`request failed for ${secret} payload-secret url-secret`); } });
  await fixture.dispatcher.tick();
  fixture.advance(1_000);
  await fixture.dispatcher.tick();

  assert.equal(fixture.state().status, "FAILED");
  assert.equal(fixture.state().attemptCount, 2);
  assert.equal(fixture.state().lastError, "Network request failed");
  const logged = JSON.stringify(fixture.logs);
  assert.doesNotMatch(logged, /whsec_|payload-secret|url-secret|agent\.example/);
});

test("timeouts follow the same retry policy", async () => {
  const fixture = harness({ maxAttempts: 1, timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }) });
  await fixture.dispatcher.tick();
  assert.equal(fixture.state().status, "FAILED");
  assert.equal(fixture.state().lastError, "Delivery timed out");
});
