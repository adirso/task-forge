import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCommand } from "../src/command.js";
import { SmithyRunner } from "../src/runner.js";
import { sign, verifySignature, redact } from "../src/security.js";

const secret = "runner-secret";
const event = { id: "event-1", event: "task.assigned", task: { id: "00000000-0000-4000-8000-000000000064", projectKey: "TAS", title: "Build runner", description: "Implement it", definitionOfDone: "Tests pass" } };
const provider = { cmd: "claude -p {prompt}", repo: "/tmp/repo", webhookSecret: secret, apiToken: "tf_test" };

test("signature verification enforces timestamp and exact body", () => {
  const timestamp = 1_700_000_000;
  const body = JSON.stringify(event);
  const header = `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
  assert.equal(verifySignature(secret, header, body, timestamp), true);
  assert.equal(verifySignature(secret, header, body + " ", timestamp), false);
  assert.equal(verifySignature(secret, header, body, timestamp + 301), false);
});

test("command templates become argument arrays without shell execution", () => {
  const command = renderCommand("codex exec '{prompt}'", "quote; echo unsafe");
  assert.equal(command.executable, "codex");
  assert.deepEqual(command.args, ["exec", "quote; echo unsafe"]);
});

test("runner routes signed events, executes once, and deduplicates delivery", async () => {
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); return path.endsWith("/runs") ? { run: { id: "run-1" } } : {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "ok", stderr: "" }), () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  assert.equal((await runner.handle("claude", headers, body)).body, JSON.stringify({ accepted: true, duplicate: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [`/api/tasks/${event.task.id}/runs`, "/api/runs/run-1/claim", "/api/runs/run-1/complete"]);
});

test("runner rejects unknown providers, bad signatures, and missing local commands", async () => {
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); return path.endsWith("/runs") ? { run: { id: "run-failed" } } : {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: null, stdout: "", stderr: "", error: new Error("spawn ENOENT token=tf_private") }), () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  assert.equal((await runner.handle("cursor", {}, body)).status, 404);
  assert.equal((await runner.handle("claude", {}, body)).status, 401);
  assert.match(redact("Authorization: Bearer tf_secret token=abc"), /REDACTED/);
  const signed = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", signed, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  const failed = calls.find((call) => call.path.endsWith("/complete"));
  assert.match(failed?.body ?? "", /FAILED/);
  assert.doesNotMatch(failed?.body ?? "", /tf_private/);
});
