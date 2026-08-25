import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { HEADLESS_PROVIDER_COMMANDS } from "../src/config.js";
import { executeCommand, renderCommand } from "../src/command.js";
import { SmithyRunner } from "../src/runner.js";
import { checkProvider } from "../src/preflight.js";
import { redact } from "../src/security.js";
import { sign } from "../src/security.js";
import { prepareWorktree } from "../src/worktree.js";

const execFileAsync = promisify(execFile);
const fixture = path.resolve("test/fixtures/fake-provider.mjs");
const labels = ["claude", "codex", "cursor", "custom"] as const;

test("provider matrix uses explicit headless defaults", () => {
  assert.match(HEADLESS_PROVIDER_COMMANDS.claude!, /claude -p --permission-mode auto/);
  assert.match(HEADLESS_PROVIDER_COMMANDS.codex!, /codex exec --approve-for-me/);
  assert.match(HEADLESS_PROVIDER_COMMANDS.cursor!, /cursor-agent -p --force --trust/);
  assert.equal(HEADLESS_PROVIDER_COMMANDS.custom, undefined);
});

test("fake provider matrix renders prompt arguments and streams redacted output", async () => {
  const selected = process.env.SMITHY_PROVIDER_LABEL;
  const selectedLabels = selected ? labels.filter((label) => label === selected) : labels;
  assert.equal(selectedLabels.length, selected ? 1 : labels.length, selected ? `Unknown provider matrix label: ${selected}` : "provider matrix must cover every label");
  for (const label of selectedLabels) {
    const temp = await mkdtemp(path.join(os.tmpdir(), "smithy-matrix-"));
    try {
      const prompt = "quote; echo SHOULD_NOT_RUN";
      const template = `${process.execPath} ${fixture} ${label === "custom" ? "--prompt" : "-p"} {prompt}`;
      const command = renderCommand(template, prompt);
      assert.equal(command.executable, process.execPath);
      const chunks: string[] = [];
      const result = await executeCommand(template, prompt, temp, 2_000, (stream, chunk) => chunks.push(`${stream}:${chunk}`));
      assert.equal(result.code, 0);
      assert.match(result.stdout, /SHOULD_NOT_RUN/);
      assert.ok(chunks.some((chunk) => chunk.startsWith("stdout:")));
      assert.match(redact(result.stdout), /token=\[REDACTED\]/);
      assert.doesNotMatch(redact(result.stdout), /tf_fake_secret/);
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});

test("fake provider runner is idempotent and redacts callback logs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "smithy-runner-matrix-"));
  try {
    const event = { id: "matrix-event", event: "task.assigned", task: { id: "00000000-0000-4000-8000-000000000073", number: 73, projectKey: "TAS", title: "matrix", description: "test", definitionOfDone: "pass" } };
    const provider = { cmd: `${process.execPath} ${fixture} -p {prompt}`, repo: temp, webhookSecret: "matrix-secret", apiToken: "tf_matrix" };
    const logs: string[] = [];
    let executions = 0;
    const api = { request: async (requestPath: string, init?: RequestInit) => {
      if (requestPath.includes("/api/context")) return { project: { key: "TAS", availableStatuses: ["TODO", "IN_PROGRESS"] }, task: event.task };
      if (requestPath.endsWith("/runs")) return { run: { id: "matrix-run" } };
      if (requestPath.endsWith("/agent-logs")) logs.push(String(init?.body ?? ""));
      return {};
    } };
    const runner = new SmithyRunner({ custom: provider }, () => api as never, async (...args: Parameters<typeof executeCommand>) => { executions += 1; return executeCommand(...args); }, () => 1_700_000_000_000);
    const body = JSON.stringify(event);
    const headers = { "x-taskforge-signature": `t=1700000000,v1=${sign(provider.webhookSecret, 1700000000, body)}` };
    assert.equal((await runner.handle("custom", headers, body)).status, 202);
    assert.equal((await runner.handle("custom", headers, body)).body, JSON.stringify({ accepted: true, duplicate: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(executions, 1);
    assert.ok(logs.some((log) => /\[REDACTED\]/.test(log)), logs.join("\n"));
    assert.doesNotMatch(logs.join("\n"), /tf_fake_secret|tf_matrix/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("fake provider timeout and missing installation diagnostics are deterministic", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "smithy-failure-matrix-"));
  try {
    const timeout = await executeCommand(`${process.execPath} ${fixture}`, "ignored", temp, 20, undefined, undefined);
    assert.equal(timeout.timedOut, true);
    const missing = await checkProvider("codex", { cmd: "definitely-missing-smithy-provider {prompt}", webhookSecret: "secret", apiToken: "tf_secret" }, executeCommand);
    assert.equal(missing.status, "MISSING");
    assert.doesNotMatch(missing.message, /tf_secret/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("provider worktrees are isolated and reusable", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "smithy-git-matrix-"));
  try {
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    await execFileAsync("git", ["config", "user.email", "smithy@example.test"], { cwd: repo });
    await execFileAsync("git", ["config", "user.name", "Smithy Test"], { cwd: repo });
    await writeFile(path.join(repo, "tracked.txt"), "tracked\n");
    await execFileAsync("git", ["add", "."], { cwd: repo });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: repo });
    const first = await prepareWorktree(repo, null, "matrix-task");
    const second = await prepareWorktree(repo, null, "matrix-task");
    assert.equal(first, second);
    await writeFile(path.join(first, "isolated.txt"), "only worktree\n");
    await assert.rejects(readFile(path.join(repo, "isolated.txt")));
  } finally { await rm(repo, { recursive: true, force: true }); }
});
