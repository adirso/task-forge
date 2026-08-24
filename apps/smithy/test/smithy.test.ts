import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCommand } from "../src/command.js";
import { SmithyRunner } from "../src/runner.js";
import { sign, verifySignature, redact } from "../src/security.js";
import { MemoryJobStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const secret = "runner-secret";
const event = { id: "event-1", event: "task.assigned", task: { id: "00000000-0000-4000-8000-000000000064", number: 64, projectKey: "TAS", title: "Build runner", description: "Implement it", definitionOfDone: "Tests pass" } };
const provider = { cmd: "claude -p {prompt}", repo: "/tmp/repo", webhookSecret: secret, apiToken: "tf_test" };

test("signature verification enforces timestamp and exact body", () => {
  const timestamp = 1_700_000_000;
  const body = JSON.stringify(event);
  const header = `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
  assert.equal(verifySignature(secret, header, body, timestamp), true);
  assert.equal(verifySignature(secret, header, body + " ", timestamp), false);
  assert.equal(verifySignature(secret, header, body, timestamp + 301), false);
});

test("configuration rejects non-loopback execution hosts", () => {
  assert.throws(() => loadConfig({ SMITHY_HOST: "0.0.0.0", SMITHY_PROVIDERS: "{}" }), /loopback/);
  assert.equal(loadConfig({ SMITHY_HOST: "127.0.0.1", SMITHY_PROVIDERS: "{}" }).host, "127.0.0.1");
});

test("job store deduplicates events and survives status transitions", () => {
  const store = new MemoryJobStore();
  const first = store.accept("event-store", "claude", event.task.id, JSON.stringify(event));
  assert.equal(first.duplicate, false);
  assert.equal(store.accept("event-store", "claude", event.task.id, JSON.stringify(event)).duplicate, true);
  store.markRunning("event-store");
  store.setRunId("event-store", "run-store");
  assert.equal(store.pending()[0]?.status, "RUNNING");
  store.markComplete("event-store", "SUCCEEDED");
  assert.equal(store.pending().length, 0);
});

test("SQLite job store persists dedupe and recovery state", async (t) => {
  let SqliteJobStore: typeof import("../src/store.js").SqliteJobStore;
  try { ({ SqliteJobStore } = await import("../src/store.js")); } catch { t.skip("better-sqlite3 is unavailable for this Node ABI"); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "smithy-"));
  const file = path.join(directory, "jobs.sqlite");
  let first: InstanceType<typeof SqliteJobStore>;
  try { first = new SqliteJobStore(file); } catch { t.skip("better-sqlite3 is unavailable for this Node ABI"); await rm(directory, { recursive: true, force: true }); return; }
  first.accept("event-sqlite", "codex", event.task.id, JSON.stringify(event));
  first.markRunning("event-sqlite");
  first.close?.();
  const second = new SqliteJobStore(file);
  assert.equal(second.accept("event-sqlite", "codex", event.task.id, JSON.stringify(event)).duplicate, true);
  assert.equal(second.pending()[0]?.status, "RUNNING");
  second.close?.();
  await rm(directory, { recursive: true, force: true });
});

test("command templates become argument arrays without shell execution", () => {
  const command = renderCommand("codex exec '{prompt}'", "quote; echo unsafe");
  assert.equal(command.executable, "codex");
  assert.deepEqual(command.args, ["exec", "quote; echo unsafe"]);
});

test("runner routes signed events, executes once, and deduplicates delivery", async () => {
  const calls: string[] = [];
  const bodies: Record<string, string> = {};
  const api = { request: async (path: string, init?: RequestInit) => { calls.push(path); bodies[path] = String(init?.body ?? ""); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return path.endsWith("/runs") ? { run: { id: "run-1" } } : {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "ok", stderr: "" }), () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  assert.equal((await runner.handle("claude", headers, body)).body, JSON.stringify({ accepted: true, duplicate: true }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes(`/api/context?project=TAS&task=TAS-64`));
  assert.ok(calls.includes(`/api/tasks/${event.task.id}/runs`));
  assert.ok(calls.includes("/api/runs/run-1/claim"));
  assert.ok(calls.includes("/api/runs/run-1/complete"));
  assert.equal(bodies["/api/runs/run-1/claim"], JSON.stringify({ leaseMs: 120000 }));
});

test("runner rejects unknown providers, bad signatures, and missing local commands", async () => {
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return path.endsWith("/runs") ? { run: { id: "run-failed" } } : {}; } };
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

test("runner ignores an out-of-order status event after the task has moved on", async () => {
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["IN_PROGRESS", "IN_REVIEW"] }, task: { ...event.task, status: "IN_REVIEW" } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { throw new Error("must not execute"); }, () => 1_700_000_000_000);
  const stale = { ...event, event: "task.status_changed", task: { ...event.task, status: "IN_PROGRESS" } };
  const body = JSON.stringify(stale);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((path) => path.includes("/api/context")));
  assert.equal(calls.some((path) => path.includes("/runs")), false);
});

test("runner processes a status event when context is still at the previous status", async () => {
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["IN_PROGRESS", "IN_REVIEW"] }, task: { ...event.task, status: "IN_PROGRESS" } }; return path.endsWith("/runs") ? { run: { id: "run-lagged" } } : {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "ok", stderr: "" }), () => 1_700_000_000_000);
  const valid = { ...event, event: "task.status_changed", previousStatus: "IN_PROGRESS", task: { ...event.task, status: "IN_REVIEW" } };
  const body = JSON.stringify(valid); const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some((path) => path.endsWith("/runs")));
});

test("runner resumes a persisted pending job with the same event and run correlation", async () => {
  const store = new MemoryJobStore(); const accepted = store.accept("event-resume", "claude", event.task.id, JSON.stringify(event)); store.setRunId("event-resume", "run-existing");
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "ok", stderr: "" }), () => 1_700_000_000_000, store);
  await runner.resume(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.job.runId, "run-existing");
  assert.ok(calls.includes("/api/runs/run-existing/claim"));
  assert.ok(calls.includes("/api/runs/run-existing/complete"));
});
