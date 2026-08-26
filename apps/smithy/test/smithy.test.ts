import assert from "node:assert/strict";
import { test } from "node:test";
import { executeCommand, renderCommand } from "../src/command.js";
import { SmithyRunner } from "../src/runner.js";
import { sign, verifySignature, redact } from "../src/security.js";
import { MemoryJobStore } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { readProviders, writeProviders } from "../src/env-file.js";
import { checkProvider, runProviderPreflight } from "../src/preflight.js";
import { createSmithyServer } from "../src/server.js";

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
  assert.equal(loadConfig({ SMITHY_HOST: "127.0.0.1", SMITHY_PREFLIGHT: "true", SMITHY_PROVIDERS: JSON.stringify({ codex: { cmd: "codex exec {prompt}", healthCmd: "codex login status", webhookSecret: "secret", apiToken: "token" } }) }).preflight, true);
});

test("provider preflight is optional, provider-neutral, and redacts diagnostics", async () => {
  const labels = ["claude", "codex", "cursor", "custom"];
  const providers = Object.fromEntries(labels.map((label) => [label, { cmd: `${label} {prompt}`, webhookSecret: "secret", apiToken: "tf_private" } ]));
  const commands: string[] = [];
  const execute = async (command: string) => { commands.push(command); return { code: 0, stdout: `${command} version 1`, stderr: "" }; };
  const healthy = await runProviderPreflight(providers, execute as never);
  assert.deepEqual(healthy.map((result) => result.status), ["OK", "OK", "OK", "OK"]);
  assert.deepEqual(commands, ["claude --version", "codex --version", "cursor --version", "custom --version"]);
  assert.ok(healthy.every((result) => !result.message.includes("tf_private")));
  const missing = await checkProvider("codex", providers.codex!, async () => ({ code: null, stdout: "", stderr: "", error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }) }) as never);
  assert.equal(missing.status, "MISSING");
  const unauthenticated = await checkProvider("claude", providers.claude!, async () => ({ code: 1, stdout: "", stderr: "Error: authentication required; token=tf_private" }) as never);
  assert.equal(unauthenticated.status, "UNAUTHENTICATED");
  assert.doesNotMatch(unauthenticated.message, /tf_private/);
  const denied = await checkProvider("cursor", providers.cursor!, async () => ({ code: null, stdout: "", stderr: "permission denied", error: Object.assign(new Error("permission denied"), { code: "EACCES" }) }) as never);
  assert.equal(denied.status, "PERMISSION_DENIED");
});

test("health endpoint runs on-demand checks even when startup preflight is disabled", async () => {
  const runner = { resume: async () => undefined, handle: async () => ({ status: 202, body: "{}" }) };
  const config = { host: "127.0.0.1", port: 0, apiUrl: "http://127.0.0.1:4000", dbPath: ":memory:", preflight: false, providers: { claude: { cmd: `${process.execPath} {prompt}`, webhookSecret: "secret", apiToken: "tf_private" } } };
  const server = createSmithyServer(config, runner as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/health/providers`);
    assert.equal(response.status, 200);
    const body = await response.json() as { enabled: boolean; providers: Array<{ provider: string; status: string; message: string }> };
    assert.equal(body.enabled, true);
    assert.equal(body.providers[0]?.provider, "claude");
    assert.equal(body.providers[0]?.status, "OK");
    assert.doesNotMatch(JSON.stringify(body), /tf_private/);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});


test("provider env updates preserve unrelated settings and support custom labels", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "smithy-env-"));
  const file = path.join(directory, ".env");
  try {
    await writeProviders(file, { claude: { cmd: "claude -p {prompt}", webhookSecret: "secret", apiToken: "token" } });
    const first = await readFile(file, "utf8");
    await writeProviders(file, { other: { cmd: "my-agent {prompt}", webhookSecret: "secret-2", apiToken: "token-2" } });
    const second = await readFile(file, "utf8");
    assert.match(first, /SMITHY_PROVIDERS=/);
    assert.match(second, /"other"/);
    assert.deepEqual(await readProviders(file), { other: { cmd: "my-agent {prompt}", webhookSecret: "secret-2", apiToken: "token-2" } });
  } finally { await rm(directory, { recursive: true, force: true }); }
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
  store.markComplete("event-store", "FAILED");
  assert.equal(store.requeue("event-store"), true);
  assert.equal(store.pending()[0]?.status, "PENDING");
  store.cancel("event-store");
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
  first.setRunId("event-sqlite", "run-sqlite");
  first.close?.();
  const second = new SqliteJobStore(file);
  const duplicate = second.accept("event-sqlite", "codex", event.task.id, JSON.stringify(event));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.runId, "run-sqlite");
  assert.equal(second.pending()[0]?.status, "RUNNING");
  second.markComplete("event-sqlite", "FAILED");
  assert.equal(second.requeue("event-sqlite"), true);
  const concurrent = new SqliteJobStore(file);
  assert.equal(concurrent.accept("event-sqlite", "codex", event.task.id, JSON.stringify(event)).duplicate, true);
  assert.equal(concurrent.cancel("event-sqlite"), true);
  assert.equal(concurrent.pending().length, 0);
  concurrent.close?.();
  second.close?.();
  await rm(directory, { recursive: true, force: true });
});

test("command templates become argument arrays without shell execution", () => {
  const command = renderCommand("codex exec '{prompt}'", "quote; echo unsafe");
  assert.equal(command.executable, "codex");
  assert.deepEqual(command.args, ["exec", "quote; echo unsafe"]);
});

test("provider commands cannot hang on stdin and stream output", async () => {
  const output: string[] = [];
  const result = await executeCommand(
    `${process.execPath} -e "console.log('ready'); process.stdin.resume(); setTimeout(() => process.exit(0), 20)"`,
    "ignored",
    process.cwd(),
    2_000,
    (stream, chunk) => output.push(`${stream}:${chunk}`),
  );
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /ready/);
  assert.ok(output.some((chunk) => chunk.includes("stdout:ready")));
});

test("provider command timeout is explicit", async () => {
  const result = await executeCommand(`${process.execPath} -e "setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 20);
  assert.equal(result.code, null);
  assert.equal(result.timedOut, true);
});

test("provider command cancellation terminates the child", async () => {
  const controller = new AbortController();
  const resultPromise = executeCommand(`${process.execPath} -e "setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 2_000, undefined, controller.signal);
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
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
  assert.ok(calls.includes(`/api/tasks/${event.task.id}/agent-logs`));
  assert.doesNotMatch(String((JSON.parse(bodies[`/api/tasks/${event.task.id}/updates`] ?? "{}") as { body?: string }).body), /Provider response/);
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

test("legacy projects do not interpret IN_PROGRESS as a fix run", async () => {
  const calls: string[] = [];
  const api = { request: async (path: string) => {
    calls.push(path);
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: { ...event.task, status: "IN_PROGRESS" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { throw new Error("must not execute"); }, () => 1_700_000_000_000);
  const statusEvent = { ...event, id: "event-legacy-in-progress", event: "task.status_changed", previousStatus: "TODO", task: { ...event.task, status: "IN_PROGRESS" } };
  const body = JSON.stringify(statusEvent);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((path) => path.endsWith("/runs")), false);
});

test("runner leaves task transitions to the assigned agent and explains the workflow", async () => {
  const statusUpdates: string[] = [];
  let prompt = "";
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["BACKLOG", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW"] }, task: { ...event.task, status: "BACKLOG" } };
    if (path.includes("/api/tasks/") && init?.method === "PATCH") statusUpdates.push(String(init.body));
    if (path.endsWith("/runs")) return { run: { id: "run-backlog" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statusUpdates, []);
  assert.match(prompt, /Smithy never changes the task status/);
  assert.match(prompt, /Branch: \(no branch configured\)/);
  assert.match(prompt, /Enabled workflow statuses: BACKLOG, TODO, IN_PROGRESS, READY_FOR_REVIEW/);
  assert.match(prompt, /PATCH \/api\/tasks\/00000000-0000-4000-8000-000000000064 with \{"status":"IN_PROGRESS","runId":"run-backlog"\}/);
  assert.match(prompt, /PATCH \/api\/tasks\/00000000-0000-4000-8000-000000000064 with \{"status":"READY_FOR_REVIEW","runId":"run-backlog"\}/);
});

test("runner gives fix and re-review jobs focused, status-aware prompts", async () => {
  for (const [status, expected] of [["FIX_NEEDED", /existing branch/], ["RE_REVIEW", /previously reviewed/] ] as const) {
    let prompt = "";
    const api = { request: async (path: string) => {
      if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["IN_PROGRESS", "READY_FOR_REVIEW", "RE_REVIEW", "FIX_NEEDED"] }, task: { ...event.task, branch: "agent/tas-64-existing", status } };
      if (path.endsWith("/runs")) return { run: { id: `run-${status.toLowerCase()}` } };
      return {};
    } };
    const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
    const modeEvent = { ...event, id: `event-${status}`, event: "task.status_changed", task: { ...event.task, status, branch: "agent/tas-64-existing" } };
    const body = JSON.stringify(modeEvent); const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
    assert.equal((await runner.handle("claude", headers, body)).status, 202);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(prompt, expected);
    assert.match(prompt, /\/api\/tasks\/00000000-0000-4000-8000-000000000064\/updates/);
    assert.match(prompt, /\/api\/tasks\/00000000-0000-4000-8000-000000000064\/agent-logs/);
    assert.match(prompt, /Enabled workflow statuses/);
  }
});

test("runner uses the project workflow mapping and ignores ordinary updates", async () => {
  let prompt = "";
  const calls: string[] = [];
  let contextStatus = "QUEUE";
  const workflow = { implementationQueue: "QUEUE", implementationStart: "BUILDING", reviewHandoff: "HANDOFF", reviewStart: "REVIEWING", approved: "APPROVED", fixNeeded: "CHANGES", fixStart: "FIXING", reReview: "RECHECK" };
  const api = { request: async (path: string) => {
    calls.push(path);
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: Object.values(workflow), agentWorkflow: workflow }, task: { ...event.task, status: contextStatus, branch: "agent/custom" } };
    if (path.endsWith("/findings")) return { findings: [{ severity: "P2", disposition: "OPEN", title: "Review item", body: "Inspect this path." }] };
    if (path.endsWith("/runs")) return { run: { id: "run-custom" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const assigned = { ...event, id: "event-custom", task: { ...event.task, status: "QUEUE", branch: "agent/custom" } };
  const body = JSON.stringify(assigned);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(prompt, /status":"BUILDING/);
  assert.match(prompt, /status":"HANDOFF/);
  assert.match(prompt, /Branch: agent\/custom/);

  contextStatus = "HANDOFF";
  const review = { ...event, id: "event-custom-review", event: "task.status_changed", previousStatus: "BUILDING", task: { ...event.task, status: "HANDOFF", branch: "agent/custom" } };
  const reviewBody = JSON.stringify(review);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, reviewBody)}` }, reviewBody);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(prompt, /status":"REVIEWING/);
  assert.match(prompt, /Review findings:/);
  assert.match(prompt, /Review item/);

  const update = { ...event, id: "event-comment", event: "task.update_added", task: { ...event.task, status: "QUEUE" } };
  const updateBody = JSON.stringify(update);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, updateBody)}` }, updateBody);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((path) => path.endsWith("/runs")).length, 2);
});

test("runner executes the configured implementation-review-fix-re-review loop with correlated runs", async () => {
  const workflow = { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "FIX_IN_PROGRESS", reReview: "RE_REVIEW" };
  const calls: Array<{ path: string; body?: string }> = [];
  const prompts: string[] = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    calls.push({ path, body: String(init?.body ?? "") });
    if (path.includes("/api/context")) {
      return { project: { key: "TAS", availableStatuses: Object.values(workflow), agentWorkflow: workflow }, task: { ...event.task, status: currentStatus, branch: "agent/tas-83-loop" } };
    }
    return {};
  } };
  let currentStatus = "TODO";
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, prompt) => { prompts.push(prompt); return { code: 0, stdout: "fake provider ok", stderr: "" }; }, () => 1_700_000_000_000);
  const events = [
    { id: "loop-implementation", event: "task.assigned", status: "TODO", previousStatus: undefined, runId: "run-implementation" },
    { id: "loop-review", event: "task.status_changed", status: "READY_FOR_REVIEW", previousStatus: "IN_PROGRESS", runId: "run-review" },
    { id: "loop-fix", event: "task.status_changed", status: "FIX_NEEDED", previousStatus: "IN_REVIEW", runId: "run-fix" },
    { id: "loop-rereview", event: "task.status_changed", status: "RE_REVIEW", previousStatus: "FIX_IN_PROGRESS", runId: "run-rereview" },
  ];
  for (const item of events) {
    currentStatus = item.status;
    const body = JSON.stringify({ ...event, id: item.id, event: item.event, runId: item.runId, previousStatus: item.previousStatus, task: { ...event.task, status: item.status, branch: "agent/tas-83-loop" } });
    const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
    assert.equal((await runner.handle("claude", headers, body)).status, 202);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(prompts.length, 4);
  assert.match(prompts[0]!, /implementation start/);
  assert.match(prompts[1]!, /review start/);
  assert.match(prompts[2]!, /fix start/);
  assert.match(prompts[3]!, /re-review start/);
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/claim")).map((call) => call.path.split("/").at(-2)), ["run-implementation", "run-review", "run-fix", "run-rereview"]);
  assert.equal(calls.filter((call) => call.path.endsWith("/runs")).length, 0, "webhook run IDs are reused rather than creating duplicate runs");
});

test("runner includes redacted findings in fix prompts and rejects invalid mappings visibly", async () => {
  let prompt = "";
  const workflow = { implementationQueue: "QUEUE", implementationStart: "BUILDING", reviewHandoff: "HANDOFF", reviewStart: "REVIEWING", approved: "APPROVED", fixNeeded: "CHANGES", fixStart: "FIXING", reReview: "RECHECK" };
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: Object.values(workflow), agentWorkflow: workflow }, task: { ...event.task, status: "CHANGES", branch: "agent/custom" } };
    if (path.endsWith("/findings")) return { findings: [{ severity: "P1", disposition: "OPEN", title: "Leaked token", body: "token=secret-value" }] };
    if (path.endsWith("/runs")) return { run: { id: "run-findings" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const fixEvent = { ...event, id: "event-findings", event: "task.status_changed", task: { ...event.task, status: "CHANGES", branch: "agent/custom" } };
  const body = JSON.stringify(fixEvent);
  assert.equal((await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(prompt, /Review findings:/);
  assert.match(prompt, /Leaked token/);
  assert.doesNotMatch(prompt, /secret-value/);

  let failure = "";
  const invalidApi = { request: async (path: string, init?: RequestInit) => {
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["QUEUE", "BUILDING"], agentWorkflow: { ...workflow, reviewHandoff: "HANDOFF" } }, task: { ...event.task, status: "QUEUE" } };
    if (path.endsWith("/updates")) { failure = String(init?.body ?? ""); return {}; }
    return {};
  } };
  const invalidRunner = new SmithyRunner({ claude: provider }, () => invalidApi as never, async () => { throw new Error("must not execute"); }, () => 1_700_000_000_000);
  const invalidBody = JSON.stringify({ ...event, id: "event-invalid-map", task: { ...event.task, status: "QUEUE" } });
  await invalidRunner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, invalidBody)}` }, invalidBody);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(failure, /Invalid project agent workflow mapping/);

  failure = "";
  const update = { ...event, id: "event-invalid-map-update", event: "task.update_added", task: { ...event.task, status: "QUEUE" } };
  const updateBody = JSON.stringify(update);
  await invalidRunner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, updateBody)}` }, updateBody);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failure, "", "ordinary updates remain inert even when a mapping is invalid");
});

test("runner fails closed when a fix run has no existing branch", async () => {
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    calls.push({ path, body: String(init?.body ?? "") });
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["FIX_NEEDED", "IN_PROGRESS"] }, task: { ...event.task, status: "FIX_NEEDED", branch: null } };
    return path.endsWith("/runs") ? { run: { id: "run-no-branch" } } : {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { throw new Error("must not execute"); }, () => 1_700_000_000_000);
  const fixEvent = { ...event, id: "event-fix-no-branch", event: "task.status_changed", task: { ...event.task, status: "FIX_NEEDED", branch: null } };
  const body = JSON.stringify(fixEvent); const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.path.endsWith("/runs")), false);
  assert.match(calls.find((call) => call.path.endsWith("/updates"))?.body ?? "", /existing task branch/);
});

test("runner does not invent a transition when the workflow lacks semantic statuses", async () => {
  let prompt = "";
  const patches: string[] = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO"] }, task: { ...event.task, status: "TODO" } };
    if (init?.method === "PATCH") patches.push(path);
    if (path.endsWith("/runs")) return { run: { id: "run-minimal" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(patches, []);
  assert.match(prompt, /IN_PROGRESS is not enabled/);
  assert.match(prompt, /ask the operator if no suitable transition exists/);
  assert.match(prompt, /If a status PATCH returns 4xx/);
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

test("runner only resumes stale RUNNING jobs after the lease window", async () => {
  const freshStore = new MemoryJobStore();
  const fresh = freshStore.accept("event-fresh-running", "claude", event.task.id, JSON.stringify(event)).job;
  freshStore.markRunning(fresh.eventId);
  let freshExecutions = 0;
  const api = { request: async (path: string) => { if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-recovered" } }; return {}; } };
  const freshRunner = new SmithyRunner({ claude: provider }, () => api as never, async () => { freshExecutions += 1; return { code: 0, stdout: "", stderr: "" }; }, () => Date.parse(fresh.updatedAt) + 60_000, freshStore);
  await freshRunner.resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(freshExecutions, 0);

  const staleStore = new MemoryJobStore();
  const stale = staleStore.accept("event-stale-running", "claude", event.task.id, JSON.stringify(event)).job;
  staleStore.markRunning(stale.eventId);
  const staleUpdatedAt = Date.parse(stale.updatedAt);
  let staleExecutions = 0;
  const staleRunner = new SmithyRunner({ claude: provider }, () => api as never, async () => { staleExecutions += 1; return { code: 0, stdout: "", stderr: "" }; }, () => staleUpdatedAt + 120_001, staleStore);
  await staleRunner.resume();
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  assert.equal(staleExecutions, 1);
});

test("lease loss requeues the SQLite job and resumes the same run without terminal overwrite", async () => {
  const store = new MemoryJobStore();
  let executions = 0;
  let heartbeats = 0;
  let runCreates = 0;
  let completions = 0;
  const api = { request: async (path: string) => {
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task };
    if (path.endsWith("/runs")) { runCreates += 1; return { run: { id: "run-lease-recovery" } }; }
    if (path.endsWith("/heartbeat")) { heartbeats += 1; if (heartbeats === 1) throw new Error('TaskForge API returned HTTP 400: {"error":"Agent run lease is not owned by this actor"}'); return {}; }
    if (path.endsWith("/complete")) { completions += 1; return {}; }
    return {};
  } };
  const execute = async (_command: string, _prompt: string, _cwd: string, _timeout: unknown, _onChunk: unknown, signal?: AbortSignal) => {
    executions += 1;
    if (executions === 1) await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
    return { code: 0, stdout: "ok", stderr: "" };
  };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, execute as never, () => 1_700_000_000_000, store, undefined, 1);
  const body = JSON.stringify({ ...event, id: "event-lease-recovery" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(executions, 2);
  assert.equal(runCreates, 1);
  assert.equal(completions, 1);
  assert.equal(store.pending().length, 0);
});

test("runner replays a failed duplicate without creating a second run", async () => {
  let executions = 0;
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-retry" } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { executions += 1; return executions === 1 ? { code: 1, stdout: "", stderr: "first failure" } : { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify({ ...event, id: "event-retry" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  const retry = await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(retry.body, /\"retried\":true/);
  assert.equal(executions, 2);
  assert.equal(calls.filter((path) => path.endsWith("/runs")).length, 1);
  assert.equal(calls.filter((path) => path.endsWith("/complete")).length, 2);
});

test("runner bounds failed duplicate replays to three local attempts", async () => {
  let executions = 0;
  const api = { request: async (path: string) => { if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-bounded" } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { executions += 1; return { code: 1, stdout: "", stderr: "failure" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify({ ...event, id: "event-bounded" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  const exhausted = await runner.handle("claude", headers, body);
  assert.match(exhausted.body, /retryExhausted/);
  assert.equal(executions, 3);
});

test("runner prevents concurrent jobs for the same task", async () => {
  let executions = 0;
  let release!: () => void;
  const running = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: `run-${calls.length}` } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { executions += 1; await running; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const first = { ...event, id: "event-concurrent-1" };
  const second = { ...event, id: "event-concurrent-2" };
  const signed = (value: object) => { const body = JSON.stringify(value); return { body, headers: { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` } }; };
  await runner.handle("claude", signed(first).headers, signed(first).body);
  await new Promise((resolve) => setImmediate(resolve));
  await runner.handle("claude", signed(second).headers, signed(second).body);
  assert.equal(executions, 1);
  assert.equal(calls.filter((path) => path.endsWith("/runs")).length, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
});

test("runner cancellation aborts the provider and completes the correlated run", async () => {
  let signal!: AbortSignal;
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-cancel" } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (...args: unknown[]) => {
    signal = args[5] as AbortSignal;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { code: null, stdout: "", stderr: "", cancelled: true };
  }, () => 1_700_000_000_000);
  const body = JSON.stringify({ ...event, id: "event-cancel" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(signal);
  assert.equal(runner.cancel("event-cancel"), true);
  await new Promise((resolve) => setImmediate(resolve));
  const completion = calls.find((call) => call.path.endsWith("/complete"));
  assert.match(completion?.body ?? "", /CANCELLED/);
});

test("runner cancellation during worktree preparation prevents provider start", async () => {
  let executions = 0;
  let release!: () => void;
  const preparing = new Promise<void>((resolve) => { release = resolve; });
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-pre-cancel" } }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { executions += 1; return { code: 0, stdout: "", stderr: "" }; }, () => 1_700_000_000_000, new MemoryJobStore(), async () => { await preparing; return "/tmp/repo"; });
  const body = JSON.stringify({ ...event, id: "event-pre-cancel" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runner.cancel("event-pre-cancel"), true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executions, 0);
});
