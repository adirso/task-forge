import assert from "node:assert/strict";
import test from "node:test";
import { dispatchForceCycle } from "../src/lib/force-cycle.js";
import { verifyWebhookSignature } from "../src/lib/webhook.js";

test("TaskForge signs the Smithy force-cycle request without exposing its secret", async () => {
  let observedUrl = "";
  let signature = "";
  let body = "";
  let observedAddress = "";
  await dispatchForceCycle("https://agent.example/agents/codex", "force-secret", 4, { id: "force-1", taskId: "task-1", eventId: "event-1", priorCount: 6, newLimit: 7 }, {
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async (destination, options) => {
      observedUrl = destination.url.toString(); observedAddress = destination.addresses[0]!.address;
      signature = options.headers["X-TaskForge-Signature"]!; body = options.body;
      return { status: 202 };
    },
    now: () => 1_700_000_000_000,
  });
  assert.equal(observedUrl, "https://agent.example/agents/codex/force-cycle");
  assert.equal(observedAddress, "93.184.216.34");
  const timestamp = 1_700_000_000;
  assert.equal(verifyWebhookSignature("force-secret", timestamp, body, signature.split("v1=")[1]!), true);
  assert.doesNotMatch(body, /force-secret/);
});

test("Smithy dispatch failures are redacted", async () => {
  await assert.rejects(
    () => dispatchForceCycle("https://agent.example/agents/codex", "force-secret", 1, { id: "force-1", taskId: "task-1", eventId: "event-1", priorCount: 6, newLimit: 7 }, {
      resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({ status: 500 }),
    }),
    (error: Error) => error.message === "Smithy could not start the additional cycle" && !/tf_private|do-not-leak/.test(error.message),
  );
});

test("force-cycle dispatch rejects private DNS results without making a request", async () => {
  let requested = false;
  await assert.rejects(() => dispatchForceCycle("https://agent.example/agents/codex", "force-secret", 1, { id: "force-1", taskId: "task-1", eventId: "event-1", priorCount: 6, newLimit: 7 }, {
    resolveAddresses: async () => [{ address: "169.254.169.254", family: 4 }],
    request: async () => { requested = true; return { status: 202 }; },
  }), /could not start/);
  assert.equal(requested, false);
});
