import assert from "node:assert/strict";
import { test } from "node:test";
import { executeCommand, providerEnvironment, renderCommand } from "../src/command.js";
import { SmithyRunner, parseProviderUsage } from "../src/runner.js";
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
import { buildSandboxInvocation, DEFAULT_SANDBOX_POLICY, DISABLED_SANDBOX_POLICY, parseSandboxPolicy } from "../src/sandbox.js";

const secret = "runner-secret";
const event = { id: "event-1", event: "task.assigned", task: { id: "00000000-0000-4000-8000-000000000064", number: 64, projectKey: "TAS", title: "Build runner", description: "Implement it", definitionOfDone: "Tests pass" } };
const provider = { cmd: "claude -p {prompt}", repo: "/tmp/repo", webhookSecret: secret, apiToken: "tf_test" };
const runCredential = { credential: { token: "tfr_test_scoped", expiresAt: "2099-01-01T00:00:00.000Z" } };

test("signature verification enforces timestamp and exact body", () => {
  const timestamp = 1_700_000_000;
  const body = JSON.stringify(event);
  const header = `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
  assert.equal(verifySignature(secret, header, body, timestamp), true);
  assert.equal(verifySignature(secret, header, body + " ", timestamp), false);
  assert.equal(verifySignature(secret, header, body, timestamp + 301), false);
});

test("provider-neutral usage envelopes aggregate valid values and ignore malformed metrics", () => {
  assert.deepEqual(parseProviderUsage('TASKFORGE_USAGE: {"inputTokens":12,"outputTokens":3,"costMicros":42,"toolCalls":2}\nnoise\nTASKFORGE_USAGE={"inputTokens":8}\nTASKFORGE_USAGE: secret'), { inputTokens: 20, outputTokens: 3, costMicros: 42, toolCalls: 2 });
});

test("configuration rejects non-loopback execution hosts", () => {
  assert.throws(() => loadConfig({ SMITHY_HOST: "0.0.0.0", SMITHY_PROVIDERS: "{}" }), /loopback/);
  assert.equal(loadConfig({ SMITHY_HOST: "127.0.0.1", SMITHY_PROVIDERS: "{}" }).host, "127.0.0.1");
  assert.equal(loadConfig({ SMITHY_HOST: "127.0.0.1", SMITHY_PREFLIGHT: "true", SMITHY_PROVIDERS: JSON.stringify({ codex: { cmd: "codex exec {prompt}", healthCmd: "codex login status", webhookSecret: "secret", apiToken: "token" } }) }).preflight, true);
  assert.equal(loadConfig({ SMITHY_PROVIDERS: "{}" }).sandbox.mode, "required");
  assert.deepEqual(loadConfig({ SMITHY_PROVIDERS: "{}" }).sandbox.networkAllow, []);
});

test("sandbox configuration validates allowlists and resource limits", () => {
  const sandbox = parseSandboxPolicy(JSON.stringify({
    readPaths: ["~/provider-config"], writePaths: ["/tmp/smithy-cache"],
    networkAllow: ["github.com:443"], environmentAllow: ["GH_CONFIG_DIR"],
    cpuSeconds: 60, memoryMb: 512, runtimeMs: 10_000, maxProcesses: 8, maxOutputBytes: 2_048,
  }), "/home/smithy");
  assert.deepEqual(sandbox.readPaths, ["/home/smithy/provider-config"]);
  assert.deepEqual(sandbox.networkAllow, ["github.com:443"]);
  assert.equal(sandbox.maxProcesses, 8);
  assert.throws(() => parseSandboxPolicy('{"readPaths":["/"]}'), /filesystem root/);
  assert.throws(() => parseSandboxPolicy('{"environmentAllow":["SMITHY_PROVIDERS"]}'), /cannot be inherited/);
  assert.throws(() => parseSandboxPolicy('{"networkAllow":["*","github.com:443"]}'), /wildcard/);
  assert.throws(() => parseSandboxPolicy('{"networkAllow":["github.com:99999"]}'), /host:port/);
  assert.throws(() => parseSandboxPolicy('{"memoryMb":1}'), /memoryMb/);
});

test("sandbox command compilation is backend-neutral and fails closed", async () => {
  const policy = { ...DEFAULT_SANDBOX_POLICY, networkAllow: ["github.com:443"], readPaths: ["/opt/provider-auth"], writePaths: ["/tmp/provider-cache"] };
  const mac = await buildSandboxInvocation("provider", ["run"], "/work/task", policy, {
    platform: "darwin",
    extraReadPaths: ["/repo/.git"], extraWritePaths: ["/repo/.git/objects"], denyWritePaths: ["/repo/.git/hooks", "/repo/.git/config"],
    resolveExecutable: async (name) => name === "provider" ? "/usr/bin/provider" : name === "sandbox-exec" ? "/usr/bin/sandbox-exec" : null,
  });
  assert.equal(mac.executable, "/bin/sh");
  assert.equal(mac.backend, "sandbox-exec");
  assert.match(mac.args.join(" "), /github\.com:443/);
  assert.match(mac.args.join(" "), /\/work\/task/);
  assert.match(mac.args.join(" "), /ulimit|smithy-limits/);
  assert.doesNotMatch(mac.args.join(" "), /\(allow process\*\)/);
  assert.match(mac.args.join(" "), /\(allow process-exec\)/);
  assert.match(mac.args.join(" "), /\(deny file-write\* .*\/repo\/\.git\/hooks/);

  const linux = await buildSandboxInvocation("provider", ["run"], "/work/task", { ...policy, networkAllow: ["*"] }, {
    platform: "linux", pathExists: async () => true,
    extraReadPaths: ["/repo/.git"], extraWritePaths: ["/repo/.git/objects"], denyWritePaths: ["/repo/.git/hooks"],
    resolveExecutable: async (name) => ({ provider: "/usr/bin/provider", bwrap: "/usr/bin/bwrap", prlimit: "/usr/bin/prlimit" })[name] ?? null,
  });
  assert.equal(linux.executable, "/usr/bin/prlimit");
  assert.equal(linux.backend, "bwrap");
  assert.ok(linux.args.includes("--share-net"));
  assert.ok(linux.args.includes(`--cpu=${policy.cpuSeconds}:${policy.cpuSeconds}`));
  assert.ok(linux.args.includes(`--as=${policy.memoryMb * 1024 * 1024}:${policy.memoryMb * 1024 * 1024}`));
  assert.ok(linux.args.includes(`--nproc=${policy.maxProcesses}:${policy.maxProcesses}`));
  const linuxArguments = linux.args.join("\0");
  assert.match(linuxArguments, /--ro-bind\0\/repo\/\.git\0\/repo\/\.git/);
  assert.match(linuxArguments, /--bind\0\/repo\/\.git\/objects\0\/repo\/\.git\/objects/);
  assert.doesNotMatch(linuxArguments, /--bind\0\/repo\/\.git\0\/repo\/\.git(?:\0|$)/);
  assert.match(linuxArguments, /--ro-bind\0\/repo\/\.git\/hooks\0\/repo\/\.git\/hooks/);
  await assert.rejects(buildSandboxInvocation("provider", [], "/work/task", policy, {
    platform: "linux", pathExists: async () => true,
    resolveExecutable: async (name) => ({ provider: "/usr/bin/provider", bwrap: "/usr/bin/bwrap", prlimit: "/usr/bin/prlimit" })[name] ?? null,
  }), /cannot enforce a host-level network allowlist/);
  await assert.rejects(buildSandboxInvocation("provider", [], "/work/task", policy, {
    platform: "darwin", resolveExecutable: async (name) => name === "provider" ? "/usr/bin/provider" : null,
  }), /not installed/);
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
  const sandboxed = await checkProvider("custom", providers.custom!, async () => ({ code: null, stdout: "", stderr: "", error: new Error("backend unavailable token=tf_private"), policyViolation: "sandbox" }) as never);
  assert.equal(sandboxed.status, "FAILED");
  assert.match(sandboxed.message, /sandbox policy check failed/);
  assert.doesNotMatch(sandboxed.message, /tf_private/);
});

test("health endpoint runs on-demand checks even when startup preflight is disabled", async () => {
  const runner = { resume: async () => undefined, handle: async () => ({ status: 202, body: "{}" }) };
  const config = { host: "127.0.0.1", port: 0, apiUrl: "http://127.0.0.1:4000", dbPath: ":memory:", preflight: false, sandbox: { ...DISABLED_SANDBOX_POLICY }, providers: { claude: { cmd: `${process.execPath} {prompt}`, webhookSecret: "secret", apiToken: "tf_private" } } };
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

test("Smithy exposes the provider force-cycle endpoint", async () => {
  let received: { provider: string; signature?: string; body: string } | null = null;
  const runner = { resume: async () => undefined, handle: async () => ({ status: 202, body: "{}" }), cancel: () => false, forceCycle: async (providerLabel: string, headers: Record<string, string | undefined>, body: string) => { received = { provider: providerLabel, signature: headers["x-taskforge-signature"], body }; return { status: 202, body: JSON.stringify({ accepted: true }) }; } };
  const config = { host: "127.0.0.1", port: 0, apiUrl: "http://127.0.0.1:4000", dbPath: ":memory:", preflight: false, sandbox: { ...DISABLED_SANDBOX_POLICY }, providers: { claude: provider } };
  const server = createSmithyServer(config, runner as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/agents/claude/force-cycle`, { method: "POST", headers: { "X-TaskForge-Signature": "signed" }, body: JSON.stringify({ id: "force-1" }) });
    assert.equal(response.status, 202);
    assert.deepEqual(received, { provider: "claude", signature: "signed", body: JSON.stringify({ id: "force-1" }) });
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

test("force-cycle authentication grants one retry of the exact failed event", async () => {
  const store = new MemoryJobStore();
  store.accept(event.id, "claude", event.task.id, JSON.stringify(event));
  store.markRunning(event.id);
  store.markComplete(event.id, "FAILED");
  let executions = 0;
  const api = { request: async (requestPath: string) => {
    if (requestPath.endsWith("/credential")) return runCredential;
    if (requestPath.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task };
    if (requestPath.endsWith("/runs")) return { run: { id: "forced-run" } };
    if (requestPath.endsWith("/findings")) return { findings: [] };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => { executions += 1; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000, store);
  const body = JSON.stringify({ id: "force-request-1", taskId: event.task.id, eventId: event.id, priorCount: 6, newLimit: 7 });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.forceCycle("claude", { "x-taskforge-signature": "invalid" }, body)).status, 401);
  assert.equal((await runner.forceCycle("claude", headers, JSON.stringify({ ...JSON.parse(body), eventId: "unknown" }))).status, 401, "changing the signed body invalidates authentication");
  const missingBody = JSON.stringify({ ...JSON.parse(body), id: "force-missing", eventId: "unknown" });
  assert.equal((await runner.forceCycle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, missingBody)}` }, missingBody)).status, 404);
  const activeEvent = { ...event, id: "event-not-failed" };
  store.accept(activeEvent.id, "claude", activeEvent.task.id, JSON.stringify(activeEvent));
  const activeBody = JSON.stringify({ ...JSON.parse(body), id: "force-active", eventId: activeEvent.id });
  assert.equal((await runner.forceCycle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, activeBody)}` }, activeBody)).status, 409);
  assert.equal((await runner.forceCycle("claude", headers, body)).status, 202);
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  assert.equal(executions, 1);
  const duplicate = await runner.forceCycle("claude", headers, body);
  assert.match(duplicate.body, /"duplicate":true/);
  assert.equal(executions, 1);
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

test("provider environments expose only allowed process values and the run credential", () => {
  const environment = providerEnvironment({
    PATH: "/usr/bin",
    HOME: "/tmp/provider-home",
    LANG: "en_US.UTF-8",
    SMITHY_PROVIDERS: "contains-webhook-and-api-secrets",
    TASKFORGE_TOKEN: "tf_long_lived",
    TASKFORGE_WEBHOOK_SECRET: "whsec_private",
    GH_TOKEN: "github-private",
    OPENAI_API_KEY: "provider-private",
    GH_CONFIG_DIR: "/tmp/gh-config",
  }, { token: "tfr_run_only", apiUrl: "http://127.0.0.1:4000", runId: "run-1", taskId: "task-1", projectId: "project-1" }, ["GH_CONFIG_DIR", "SMITHY_PROVIDERS", "TASKFORGE_WEBHOOK_SECRET"]);
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    HOME: "/tmp/provider-home",
    LANG: "en_US.UTF-8",
    GH_CONFIG_DIR: "/tmp/gh-config",
    TASKFORGE_TOKEN: "tfr_run_only",
    TASKFORGE_API_URL: "http://127.0.0.1:4000",
    TASKFORGE_RUN_ID: "run-1",
    TASKFORGE_TASK_ID: "task-1",
    TASKFORGE_PROJECT_ID: "project-1",
  });
});

test("provider output limits stop noisy processes with an explicit policy violation", async () => {
  const result = await executeCommand(`${process.execPath} -e "process.stdout.write('x'.repeat(4096)); setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 2_000, undefined, undefined, undefined, { ...DISABLED_SANDBOX_POLICY, maxOutputBytes: 1_024 });
  assert.equal(result.policyViolation, "output");
  assert.equal(Buffer.byteLength(result.stdout), 1_024);
  assert.match(result.error?.message ?? "", /1024-byte sandbox limit/);
});

test("provider memory, process, and runtime policies terminate the process group", async () => {
  const directInvocation = async (executable: string, args: string[]) => ({ executable, args, backend: "disabled" as const });
  const memory = await executeCommand(`${process.execPath} -e "setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 2_000, undefined, undefined, undefined, { ...DEFAULT_SANDBOX_POLICY, memoryMb: 64 }, { buildInvocation: directInvocation, processGroupUsage: async () => ({ processes: 1, memoryKb: 65 * 1024 }) });
  assert.equal(memory.policyViolation, "memory");
  const processes = await executeCommand(`${process.execPath} -e "setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 2_000, undefined, undefined, undefined, { ...DEFAULT_SANDBOX_POLICY, maxProcesses: 1 }, { buildInvocation: directInvocation, processGroupUsage: async () => ({ processes: 2, memoryKb: 1 }) });
  assert.equal(processes.policyViolation, "process");
  const runtime = await executeCommand(`${process.execPath} -e "setTimeout(() => {}, 1000)"`, "ignored", process.cwd(), 2_000, undefined, undefined, undefined, { ...DEFAULT_SANDBOX_POLICY, runtimeMs: 20 }, { buildInvocation: directInvocation, processGroupUsage: async () => ({ processes: 1, memoryKb: 1 }) });
  assert.equal(runtime.timedOut, true);
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
  let providerEnv: NodeJS.ProcessEnv | undefined;
  const api = { request: async (path: string, init?: RequestInit) => { calls.push(path); bodies[path] = String(init?.body ?? ""); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return path.endsWith("/runs") ? { run: { id: "run-1" } } : {}; } };
  const runner = new SmithyRunner({ claude: { ...provider, repo: process.cwd() } }, () => api as never, async (...args: unknown[]) => { providerEnv = args[6] as NodeJS.ProcessEnv; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify(event);
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  assert.equal((await runner.handle("claude", headers, body)).status, 202);
  assert.equal((await runner.handle("claude", headers, body)).body, JSON.stringify({ accepted: true, duplicate: true }));
  for (let attempt = 0; attempt < 50 && !calls.includes("/api/runs/run-1/complete"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(calls.includes(`/api/context?project=TAS&task=TAS-64`));
  assert.ok(calls.includes(`/api/tasks/${event.task.id}/runs`));
  assert.ok(calls.includes("/api/runs/run-1/claim"));
  assert.ok(calls.includes("/api/runs/run-1/credential"));
  assert.ok(calls.includes("/api/runs/run-1/usage"));
  assert.equal(calls.filter((path) => path === "/api/runs/run-1/artifacts").length, 3);
  assert.equal(JSON.parse(bodies["/api/runs/run-1/artifacts"] ?? "{}").type, "EXECUTION_ENVIRONMENT");
  assert.match(JSON.parse(bodies["/api/runs/run-1/artifacts"] ?? "{}").metadata?.fingerprint ?? "", /^[0-9a-f]{64}$/);
  assert.ok(calls.includes("/api/runs/run-1/complete"));
  assert.equal(bodies["/api/runs/run-1/claim"], JSON.stringify({ leaseMs: 120000 }));
  assert.ok(calls.includes(`/api/tasks/${event.task.id}/agent-logs`));
  assert.equal(providerEnv?.TASKFORGE_TOKEN, "tfr_test_scoped");
  assert.equal(providerEnv?.SMITHY_PROVIDERS, undefined);
  assert.equal(providerEnv?.TASKFORGE_WEBHOOK_SECRET, undefined);
  assert.doesNotMatch(String((JSON.parse(bodies[`/api/tasks/${event.task.id}/updates`] ?? "{}") as { body?: string }).body), /Provider response/);
});

test("runner rejects unknown providers, bad signatures, and missing local commands", async () => {
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return path.endsWith("/runs") ? { run: { id: "run-failed" } } : {}; } };
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

test("runner reports redacted publication authentication failures", async () => {
  let update = "";
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.endsWith("/credential")) return runCredential;
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task };
    if (path.endsWith("/runs")) return { run: { id: "run-publish-auth" } };
    if (path.endsWith("/updates")) update = String(init?.body ?? "");
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 1, stdout: "", stderr: "git push failed: authentication required token=tf_private" }), () => 1_700_000_000_000);
  const body = JSON.stringify({ ...event, id: "event-publish-auth" });
  const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` };
  await runner.handle("claude", headers, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(update, /publication or authentication failed/);
  assert.doesNotMatch(update, /tf_private/);
});

test("runner reports sandbox violations with redacted actionable diagnostics", async () => {
  let activity = "";
  const api = { request: async (requestPath: string, init?: RequestInit) => {
    if (requestPath.endsWith("/credential")) return runCredential;
    if (requestPath.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task };
    if (requestPath.endsWith("/runs")) return { run: { id: "run-sandbox" } };
    if (requestPath.endsWith("/updates") || requestPath.endsWith("/agent-logs")) activity += String(init?.body ?? "");
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: null, stdout: "", stderr: "", error: new Error("denied token=tf_private"), policyViolation: "sandbox" as const }), () => 1_700_000_000_000);
  const sandboxEvent = { ...event, id: "event-sandbox" };
  const body = JSON.stringify(sandboxEvent);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(activity, /sandbox policy violation \(sandbox\)/i);
  assert.doesNotMatch(activity, /tf_private/);
  assert.match(activity, /\[REDACTED\]/);
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
  const api = { request: async (path: string) => { calls.push(path); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["IN_PROGRESS", "IN_REVIEW"] }, task: { ...event.task, status: "IN_PROGRESS" } }; return path.endsWith("/runs") ? { run: { id: "run-lagged" } } : {}; } };
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
    if (path.endsWith("/credential")) return runCredential;
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
  assert.match(prompt, /commit all changes, push the existing task branch/);
  assert.match(prompt, /PUT \/api\/runs\/run-backlog\/handoff/);
});

test("runner consumes the immutable context-pack version and redacts durable memory", async () => {
  let prompt = "";
  const calls: string[] = [];
  const api = { request: async (path: string) => {
    calls.push(path);
    if (path.endsWith("/credential")) return runCredential;
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["BACKLOG", "IN_PROGRESS", "READY_FOR_REVIEW"] }, task: { ...event.task, status: "BACKLOG" } };
    if (path.endsWith("/runs")) return { run: { id: "run-context-pack" } };
    if (path.endsWith("/context-pack")) return { contextPack: { version: 3, fingerprint: "b".repeat(64), content: {
      history: { decisions: [{ body: "Approved approach token=memory-secret" }], recentUpdates: [{ body: "Implementation is ready" }], findings: [], summary: { omittedSummary: "12 routine updates were summarized." } },
      dependencies: [{ projectKey: "TAS", number: 114, title: "Planning", status: "DONE", isBlocking: false }],
      attachments: [{ fileName: "evidence.txt", mimeType: "text/plain", size: 12, downloadUrl: "/api/attachments/attachment-1/download" }],
      repository: { guidanceFiles: ["AGENTS.md"], relevantFiles: ["src/context.ts"] },
    } } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => { prompt = commandPrompt; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const body = JSON.stringify({ ...event, id: "event-context-pack", task: { ...event.task, status: "BACKLOG" } });
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes("/api/runs/run-context-pack/context-pack"));
  assert.match(prompt, new RegExp(`Durable context pack: version 3; fingerprint ${"b".repeat(64)}`));
  assert.match(prompt, /TAS-114: Planning \(DONE\)/);
  assert.match(prompt, /evidence\.txt/);
  assert.match(prompt, /Historical context: Approved approach/);
  assert.doesNotMatch(prompt, /memory-secret/);
});

test("runner gives fix and re-review jobs focused, status-aware prompts", async () => {
  for (const [status, expected] of [["FIX_NEEDED", /existing branch/], ["RE_REVIEW", /previously reviewed/] ] as const) {
    let prompt = "";
    const api = { request: async (path: string) => {
      if (path.endsWith("/credential")) return runCredential;
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
    if (status === "FIX_NEEDED") {
      assert.match(prompt, /commit the fixes, push this same branch/);
      assert.match(prompt, /PUT \/api\/runs\/run-fix_needed\/handoff/);
    }
  }
});

test("review prompts include verified publication handoff context", async () => {
  let prompt = "";
  const api = { request: async (path: string) => {
    if (path.endsWith("/credential")) return runCredential;
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["READY_FOR_REVIEW", "IN_REVIEW", "APPROVED"] }, task: { ...event.task, status: "READY_FOR_REVIEW", branch: "agent/published" } };
    if (path.endsWith("/runs")) return path.includes("/tasks/") ? { runs: [{ id: "run-review-published" }, { id: "run-publisher" }] } : { run: { id: "run-review-published" } };
    if (path.endsWith("/handoff")) return path.includes("run-publisher") ? { handoff: { status: "PUBLISHED", branch: "agent/published", headSha: "a".repeat(40), branchPublished: true, pullRequestUrl: "https://github.com/example/repo/pull/9", pullRequestState: "OPEN" } } : { handoff: null };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, value) => { prompt = value; return { code: 0, stdout: "ok", stderr: "" }; }, () => 1_700_000_000_000);
  const review = { ...event, id: "event-review-published", event: "task.status_changed", runId: "run-review-published", previousStatus: "IN_PROGRESS", task: { ...event.task, status: "READY_FOR_REVIEW", branch: "agent/published" } };
  const body = JSON.stringify(review);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(prompt, /Canonical publication \(verified\)/);
  assert.match(prompt, new RegExp(`head SHA ${"a".repeat(40)}`));
  assert.match(prompt, /pull request https:\/\/github.com\/example\/repo\/pull\/9/);
});

test("runner uses the project workflow mapping and ignores ordinary updates", async () => {
  let prompt = "";
  const calls: string[] = [];
  let contextStatus = "QUEUE";
  const workflow = { implementationQueue: "QUEUE", implementationStart: "BUILDING", reviewHandoff: "HANDOFF", reviewStart: "REVIEWING", approved: "APPROVED", fixNeeded: "CHANGES", fixStart: "FIXING", reReview: "RECHECK" };
  const api = { request: async (path: string) => {
    if (path.endsWith("/credential")) return runCredential;
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
  assert.equal(calls.filter((path) => path.endsWith("/runs")).length, 3);
});

test("runner executes the configured implementation-review-fix-re-review loop with correlated runs", async () => {
  const workflow = { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "FIX_IN_PROGRESS", reReview: "RE_REVIEW" };
  const calls: Array<{ path: string; body?: string }> = [];
  const prompts: string[] = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.endsWith("/credential")) return runCredential;
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
  assert.equal(calls.filter((call) => call.path.endsWith("/runs") && call.body?.includes("kind")).length, 0, "webhook run IDs are reused rather than creating duplicate runs");
});

test("runner includes redacted findings in fix prompts and rejects invalid mappings visibly", async () => {
  let prompt = "";
  const workflow = { implementationQueue: "QUEUE", implementationStart: "BUILDING", reviewHandoff: "HANDOFF", reviewStart: "REVIEWING", approved: "APPROVED", fixNeeded: "CHANGES", fixStart: "FIXING", reReview: "RECHECK" };
  const api = { request: async (path: string, init?: RequestInit) => {
    if (path.endsWith("/credential")) return runCredential;
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
    if (path.endsWith("/credential")) return runCredential;
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
  const api = { request: async (path: string) => { calls.push(path); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; return {}; } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "ok", stderr: "" }), () => 1_700_000_000_000, store);
  await runner.resume(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.job.runId, "run-existing");
  assert.ok(calls.includes("/api/runs/run-existing/claim"));
  assert.ok(calls.includes("/api/runs/run-existing/complete"));
});

test("runner resumes an intervened run with operator input and fences callbacks by control version", async () => {
  let prompt = "";
  const calls: Array<{ path: string; body: string }> = [];
  const api = { request: async (requestPath: string, init?: RequestInit) => {
    calls.push({ path: requestPath, body: String(init?.body ?? "") });
    if (requestPath.endsWith("/claim")) return { run: { controlVersion: 7 } };
    if (requestPath.endsWith("/credential")) return runCredential;
    if (requestPath.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: { ...event.task, status: "IN_PROGRESS", branch: "agent/intervened" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, commandPrompt) => {
    prompt = commandPrompt;
    return { code: 0, stdout: "ok", stderr: "" };
  }, () => 1_700_000_000_000);
  const interventionEvent = { ...event, id: "event-answer", runId: "run-answer", runKind: "IMPLEMENTATION" as const, interventionAction: "ANSWER", operatorInput: "Use eu-west-1", task: { ...event.task, status: "IN_PROGRESS", branch: "agent/intervened" } };
  const body = JSON.stringify(interventionEvent);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(prompt, /Operator input: Use eu-west-1/);
  assert.match(prompt, /"action":"REQUEST_INPUT","controlVersion":7/);
  assert.equal(calls.some((call) => call.path.endsWith("/runs")), false, "the existing run is resumed rather than duplicated");
  assert.deepEqual(JSON.parse(calls.find((call) => call.path.endsWith("/complete"))!.body), { status: "SUCCEEDED", controlVersion: 7 });
});

test("an operator decision stops the stale worker without failure or recovery writes", async () => {
  const calls: Array<{ path: string; body: string }> = [];
  const api = { request: async (requestPath: string, init?: RequestInit) => {
    calls.push({ path: requestPath, body: String(init?.body ?? "") });
    if (requestPath.endsWith("/credential")) return runCredential;
    if (requestPath.endsWith("/claim")) return { run: { controlVersion: 4 } };
    if (requestPath.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: { ...event.task, status: "TODO", branch: "agent/waiting" } };
    if (requestPath.endsWith("/handoff") && init?.method === "PUT") throw new Error('TaskForge API returned HTTP 409: {"error":"Agent run control decision superseded this worker"}');
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async () => ({ code: 0, stdout: "waiting", stderr: "" }), () => 1_700_000_000_000);
  const controlled = { ...event, id: "event-control-superseded", runId: "run-control-superseded", runKind: "IMPLEMENTATION" as const, task: { ...event.task, status: "TODO", branch: "agent/waiting" } };
  const body = JSON.stringify(controlled);
  await runner.handle("claude", { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` }, body);
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  assert.equal(calls.filter((call) => call.path.endsWith("/handoff") && call.body.includes('"status":"PENDING"')).length, 1);
  assert.equal(calls.some((call) => call.path.endsWith("/complete")), false);
  assert.equal(calls.some((call) => call.path.endsWith("/updates") && /run failed/i.test(call.body)), false);
});

test("runner only resumes stale RUNNING jobs after the lease window", async () => {
  const freshStore = new MemoryJobStore();
  const fresh = freshStore.accept("event-fresh-running", "claude", event.task.id, JSON.stringify(event)).job;
  freshStore.markRunning(fresh.eventId);
  let freshExecutions = 0;
  const api = { request: async (path: string) => { if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-recovered" } }; return {}; } };
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

test("lease loss requeues a SQLite job and resumes the same run without terminal overwrite", async (t) => {
  let SqliteJobStore: typeof import("../src/store.js").SqliteJobStore;
  try { ({ SqliteJobStore } = await import("../src/store.js")); } catch { t.skip("better-sqlite3 is unavailable for this Node ABI"); return; }
  const directory = await mkdtemp(path.join(tmpdir(), "smithy-lease-recovery-"));
  let store: InstanceType<typeof SqliteJobStore>;
  try { store = new SqliteJobStore(path.join(directory, "jobs.sqlite")); } catch { t.skip("better-sqlite3 is unavailable for this Node ABI"); await rm(directory, { recursive: true, force: true }); return; }
  let executions = 0;
  let heartbeats = 0;
  let runCreates = 0;
  let completions = 0;
  const api = { request: async (path: string) => {
    if (path.endsWith("/credential")) return runCredential;
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
  try {
    await runner.handle("claude", headers, body);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(executions, 2);
    assert.equal(runCreates, 1);
    assert.equal(completions, 1);
    assert.equal(store.pending().length, 0);
  } finally { store.close?.(); await rm(directory, { recursive: true, force: true }); }
});

test("runner replays a failed duplicate without creating a second run", async () => {
  let executions = 0;
  const calls: string[] = [];
  const api = { request: async (path: string) => { calls.push(path); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-retry" } }; return {}; } };
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
  const api = { request: async (path: string) => { if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-bounded" } }; return {}; } };
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
  const api = { request: async (path: string) => { calls.push(path); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: `run-${calls.length}` } }; return {}; } };
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

test("a structured intervention supersedes the active local job and resumes the same API run", async () => {
  const prompts: string[] = [];
  const calls: Array<{ path: string; body: string }> = [];
  let executions = 0;
  const api = { request: async (path: string, init?: RequestInit) => {
    calls.push({ path, body: String(init?.body ?? "") });
    if (path.endsWith("/credential")) return runCredential;
    if (path.endsWith("/claim")) return { run: { controlVersion: executions + 1 } };
    if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: { ...event.task, status: "TODO", branch: "agent/intervention" } };
    return {};
  } };
  const runner = new SmithyRunner({ claude: provider }, () => api as never, async (_command, prompt, _cwd, _timeout, _onChunk, signal?: AbortSignal) => {
    executions += 1;
    prompts.push(prompt);
    if (executions === 1) {
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { code: null, stdout: "", stderr: "", cancelled: true };
    }
    return { code: 0, stdout: "resumed", stderr: "" };
  }, () => 1_700_000_000_000);
  const signed = (value: object) => { const body = JSON.stringify(value); return { body, headers: { "x-taskforge-signature": `t=1700000000,v1=${sign(secret, 1700000000, body)}` } }; };
  const initial = { ...event, id: "event-intervention-initial", runId: "run-intervention", runKind: "IMPLEMENTATION" as const, task: { ...event.task, status: "TODO", branch: "agent/intervention" } };
  await runner.handle("claude", signed(initial).headers, signed(initial).body);
  await new Promise((resolve) => setImmediate(resolve));
  const answer = { ...initial, id: "event-intervention-answer", interventionAction: "ANSWER", operatorInput: "Use eu-west-1" };
  await runner.handle("claude", signed(answer).headers, signed(answer).body);
  await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
  assert.equal(executions, 2);
  assert.match(prompts[1]!, /Operator input: Use eu-west-1/);
  assert.equal(calls.filter((call) => call.path.endsWith("/runs")).length, 0);
  assert.equal(calls.filter((call) => call.path.endsWith("/complete")).length, 1);
});

test("runner cancellation aborts the provider without a stale terminal overwrite", async () => {
  let signal!: AbortSignal;
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-cancel" } }; return {}; } };
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
  assert.equal(calls.some((call) => call.path.endsWith("/complete")), false);
});

test("runner cancellation during worktree preparation prevents provider start", async () => {
  let executions = 0;
  let release!: () => void;
  const preparing = new Promise<void>((resolve) => { release = resolve; });
  const calls: Array<{ path: string; body?: string }> = [];
  const api = { request: async (path: string, init?: RequestInit) => { calls.push({ path, body: String(init?.body ?? "") }); if (path.endsWith("/credential")) return runCredential; if (path.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task }; if (path.endsWith("/runs")) return { run: { id: "run-pre-cancel" } }; return {}; } };
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
