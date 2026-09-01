import assert from "node:assert/strict";
import test from "node:test";
import { dispatchForceCycle } from "../src/lib/force-cycle.js";
import { verifyWebhookSignature } from "../src/lib/webhook.js";

test("TaskForge signs the Smithy force-cycle request without exposing its secret", async () => {
  let observedUrl = "";
  let signature = "";
  let body = "";
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    observedUrl = String(input); signature = String((init?.headers as Record<string, string>)["X-TaskForge-Signature"]); body = String(init?.body);
    return new Response("{}", { status: 202 });
  };
  await dispatchForceCycle("http://127.0.0.1:4500/agents/codex", "force-secret", 4, { id: "force-1", taskId: "task-1", eventId: "event-1", priorCount: 6, newLimit: 7 }, fetchImpl as typeof fetch, () => 1_700_000_000_000);
  assert.equal(observedUrl, "http://127.0.0.1:4500/agents/codex/force-cycle");
  const timestamp = 1_700_000_000;
  assert.equal(verifyWebhookSignature("force-secret", timestamp, body, signature.split("v1=")[1]!), true);
  assert.doesNotMatch(body, /force-secret/);
});

test("Smithy dispatch failures are redacted", async () => {
  const fetchImpl = async () => new Response("token=tf_private secret=do-not-leak", { status: 500 });
  await assert.rejects(
    () => dispatchForceCycle("http://127.0.0.1:4500/agents/codex", "force-secret", 1, { id: "force-1", taskId: "task-1", eventId: "event-1", priorCount: 6, newLimit: 7 }, fetchImpl as typeof fetch),
    (error: Error) => error.message === "Smithy could not start the additional cycle" && !/tf_private|do-not-leak/.test(error.message),
  );
});
