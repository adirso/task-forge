import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { RepositorySet, UnitOfWork } from "../src/application/repositories.js";
import type { WebhookDeliveryEntity } from "../src/application/models.js";
import type { WebhookDestination, WebhookRequest } from "../src/lib/webhook.js";
import { requestWebhook, resolveWebhookDestination, WebhookDispatcher, verifyWebhookSignature } from "../src/lib/webhook.js";

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

function harness(input: { request?: WebhookRequest; resolveAddresses?: (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>; url?: string; maxAttempts?: number; timeoutMs?: number }) {
  let current = new Date("2026-08-23T10:00:00.000Z");
  let state = delivery();
  const logs: Record<string, unknown>[] = [];
  const repositories = {
    users: { getWebhookConfiguration: async () => ({ webhookUrl: input.url ?? "https://agent.example/webhook?token=url-secret", secretCiphertext: "encrypted-secret", secretVersion: 3 }) },
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
    request: input.request ?? (async () => ({ status: 204 })), resolveAddresses: input.resolveAddresses ?? (async () => [{ address: "93.184.216.34", family: 4 }]), now: () => new Date(current), maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs ?? 50, retryBaseMs: 1_000, retryMaxMs: 4_000,
    logger: { info: (details) => logs.push(details), warn: (details) => logs.push(details) },
  });
  return { dispatcher, state: () => state, logs, advance(milliseconds: number) { current = new Date(current.getTime() + milliseconds); } };
}

test("dispatcher signs successful deliveries and claims an event only once", async () => {
  const requests: Array<{ body: string; headers: Headers; host: string; addresses: string[] }> = [];
  const fixture = harness({ request: async (destination, options) => {
    requests.push({ body: options.body, headers: new Headers(options.headers), host: destination.url.hostname, addresses: destination.addresses.map(({ address }) => address) });
    return { status: 204 };
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
  assert.equal(request.host, "agent.example");
  assert.deepEqual(request.addresses, ["93.184.216.34"]);
  const signatureHeader = request.headers.get("x-taskforge-signature")!;
  const timestamp = Number(signatureHeader.match(/^t=(\d+),/)?.[1]);
  const signature = signatureHeader.match(/v1=([a-f0-9]{64})$/)?.[1] ?? "";
  assert.equal(verifyWebhookSignature(secret, timestamp, request.body, signature), true);
});

test("non-2xx responses retry exponentially with one stable idempotency key", async () => {
  const attempts: Array<{ key: string | null; body: string }> = [];
  const fixture = harness({ maxAttempts: 3, request: async (_destination, options) => {
    attempts.push({ key: new Headers(options.headers).get("idempotency-key"), body: options.body });
    return { status: attempts.length < 3 ? 503 : 202 };
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
  const fixture = harness({ maxAttempts: 2, request: async () => { throw new Error(`request failed for ${secret} payload-secret url-secret`); } });
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
  const fixture = harness({ maxAttempts: 1, timeoutMs: 5, request: async (_destination, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }) });
  await fixture.dispatcher.tick();
  assert.equal(fixture.state().status, "FAILED");
  assert.equal(fixture.state().lastError, "Delivery timed out");
});

test("destination parsing blocks private and special-use IPv4 and IPv6 forms", async () => {
  for (const url of [
    "http://127.0.0.1/hook", "http://127.1/hook", "http://2130706433/hook", "http://0x7f000001/hook", "http://0177.0.0.1/hook",
    "http://10.0.0.1/hook", "http://192.168.1.1/hook", "http://169.254.169.254/hook", "http://100.64.0.1/hook", "http://192.0.2.1/hook",
    "http://[::1]/hook", "http://[::ffff:127.0.0.1]/hook", "http://[fc00::1]/hook", "http://[fe80::1]/hook", "http://[2001:db8::1]/hook",
  ]) {
    await assert.rejects(() => resolveWebhookDestination(url), /not allowed/);
  }
});

test("DNS answers reject mixed public and non-public results", async () => {
  await assert.rejects(() => resolveWebhookDestination("https://mixed.example/hook", async () => [
    { address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 },
  ]), /not allowed/);
});

test("localhost hostnames resolving to loopback are rejected", async () => {
  let queriedHost = "";
  await assert.rejects(() => resolveWebhookDestination("https://localhost/webhook", async (hostname) => {
    queriedHost = hostname;
    return [{ address: "127.0.0.1", family: 4 }];
  }), /not allowed/);
  assert.equal(queriedHost, "localhost");
});

test("dispatcher pins the single validated DNS answer to defend against rebinding", async () => {
  let lookups = 0;
  const fixture = harness({
    resolveAddresses: async () => { lookups += 1; return [{ address: lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }]; },
    request: async (destination) => {
      assert.deepEqual(destination.addresses.map(({ address }) => address), ["93.184.216.34"]);
      return { status: 204 };
    },
  });
  await fixture.dispatcher.tick();
  assert.equal(lookups, 1);
  assert.equal(fixture.state().status, "DELIVERED");
});

test("public HTTPS destinations remain deliverable and redirect responses are never followed", async () => {
  let requests = 0;
  const fixture = harness({
    url: "https://hooks.example.test/events",
    request: async (destination) => {
      requests += 1;
      assert.equal(destination.url.protocol, "https:");
      assert.deepEqual(destination.addresses.map(({ address }) => address), ["93.184.216.34"]);
      return { status: 302 };
    },
  });
  await fixture.dispatcher.tick();
  assert.equal(requests, 1);
  assert.equal(fixture.state().status, "RETRYING");
  assert.equal(fixture.state().lastError, "HTTP 302");
  assert.doesNotMatch(JSON.stringify({ error: fixture.state().lastError, logs: fixture.logs }), /url-secret|encrypted-secret|whsec_test|payload-secret|agent\.example/);
});

test("transport pins the vetted address, does not follow redirects, and discards response bodies", async () => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => { redirectedRequests += 1; response.end("response-secret"); });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetPort = (target.address() as { port: number }).port;
  const source = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${targetPort}/redirect-target` });
    response.end("response-secret");
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  try {
    const sourcePort = (source.address() as { port: number }).port;
    // This unit test deliberately exercises the low-level pinned transport with a loopback socket.
    // Production callers must pass branded output from resolveWebhookDestination first.
    const response = await requestWebhook({
      url: new URL(`http://rebind-test.invalid:${sourcePort}/webhook`),
      addresses: [{ address: "127.0.0.1", family: 4 }],
    } as unknown as WebhookDestination, {
      method: "POST", headers: { "x-taskforge-signature": secret }, body: "payload-secret", signal: new AbortController().signal,
    });
    assert.deepEqual(response, { status: 302 });
    assert.equal(redirectedRequests, 0);
  } finally {
    await Promise.all([new Promise<void>((resolve, reject) => source.close((error) => error ? reject(error) : resolve())), new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve()))]);
  }
});
