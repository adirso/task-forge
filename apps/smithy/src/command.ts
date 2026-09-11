import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { buildSandboxInvocation, DISABLED_SANDBOX_POLICY, SandboxPolicyError, type SandboxPolicy } from "./sandbox.js";

/** Tokenize an operator-owned command template without invoking a shell. */
export function renderCommand(template: string, prompt: string) {
  const tokens: string[] = [];
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g;
  for (const match of template.matchAll(pattern)) {
    const token = match[0];
    const unquoted = token.startsWith('"') && token.endsWith('"') || token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
    tokens.push(unquoted === "{prompt}" ? prompt : unquoted.replaceAll("{prompt}", prompt));
  }
  if (!tokens.length || !tokens[0]) throw new Error("Provider command is empty");
  return { executable: tokens[0], args: tokens.slice(1) };
}

export type PolicyViolation = "sandbox" | "cpu" | "memory" | "process" | "output";
export interface CommandResult { code: number | null; stdout: string; stderr: string; error?: Error; timedOut?: boolean; cancelled?: boolean; policyViolation?: PolicyViolation; }
export type CommandOutput = (stream: "stdout" | "stderr", chunk: string) => void;

const SAFE_PROVIDER_ENV = ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "NO_COLOR", "PATH", "SHELL", "TERM", "TMP", "TMPDIR", "TEMP", "USER"] as const;
const PROTECTED_ENV = /^(?:SMITHY_|TASKFORGE_)|WEBHOOK/i;

/** Build a minimal environment for an untrusted provider process. */
export function providerEnvironment(parent: NodeJS.ProcessEnv, credential?: { token: string; apiUrl: string; runId: string; taskId: string; projectId: string }, environmentAllow: readonly string[] = []) {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [...SAFE_PROVIDER_ENV, ...environmentAllow]) {
    if (!PROTECTED_ENV.test(name) && parent[name] !== undefined) environment[name] = parent[name];
  }
  if (credential) {
    environment.TASKFORGE_TOKEN = credential.token;
    environment.TASKFORGE_API_URL = credential.apiUrl;
    environment.TASKFORGE_RUN_ID = credential.runId;
    environment.TASKFORGE_TASK_ID = credential.taskId;
    environment.TASKFORGE_PROJECT_ID = credential.projectId;
  }
  return environment;
}

const readGit = promisify(execFile);

export interface GitSandboxPaths { readPaths: string[]; writePaths: string[]; denyWritePaths: string[]; }

export async function gitSandboxPaths(cwd: string): Promise<GitSandboxPaths> {
  try {
    const [gitDirectory, commonDirectory] = await Promise.all([
      readGit("git", ["rev-parse", "--absolute-git-dir"], { cwd }),
      readGit("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }),
    ]);
    const gitDir = path.resolve(cwd, gitDirectory.stdout.trim());
    const commonDir = path.resolve(cwd, commonDirectory.stdout.trim());
    return {
      readPaths: [...new Set([gitDir, commonDir])],
      // A linked worktree's private git directory may be written in full. The
      // shared repository remains read-only except for Git's object/ref/log
      // stores, which are required for commit and push. Hooks and config never
      // receive a write grant.
      writePaths: [...new Set([
        ...(gitDir === commonDir ? [] : [gitDir]),
        path.join(commonDir, "objects"),
        path.join(commonDir, "refs"),
        path.join(commonDir, "logs"),
      ])],
      denyWritePaths: [path.join(cwd, ".git"), path.join(commonDir, "config"), path.join(commonDir, "hooks")],
    };
  } catch {
    return { readPaths: [], writePaths: [], denyWritePaths: [] };
  }
}

function stopProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid && process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch { /* fall back to the direct child */ }
  }
  try { child.kill(signal); } catch { /* already stopped */ }
}

function inferViolation(signal: NodeJS.Signals | null, stderr: string): PolicyViolation | undefined {
  if (signal === "SIGXCPU") return "cpu";
  if (/sandbox|operation not permitted|permission denied/i.test(stderr)) return "sandbox";
  if (/cannot allocate memory|out of memory|memory limit/i.test(stderr)) return "memory";
  if (/resource temporarily unavailable|process limit/i.test(stderr)) return "process";
  return undefined;
}

function processGroupUsage(groupId: number) {
  return new Promise<{ processes: number; memoryKb: number } | null>((resolve) => {
    try {
      execFile("ps", ["-eo", "pgid=,rss="], { timeout: 2_000 }, (error, stdout) => {
        if (error) { resolve(null); return; }
        let processes = 0;
        let memoryKb = 0;
        for (const line of stdout.split(/\r?\n/)) {
          const match = line.trim().match(/^(\d+)\s+(\d+)$/);
          if (!match || Number(match[1]) !== groupId) continue;
          processes += 1;
          memoryKb += Number(match[2]);
        }
        resolve({ processes, memoryKb });
      });
    } catch { resolve(null); }
  });
}

type CommandDependencies = {
  buildInvocation?: typeof buildSandboxInvocation;
  processGroupUsage?: typeof processGroupUsage;
};

export async function executeCommand(
  template: string,
  prompt: string,
  cwd: string,
  timeoutMs = 30 * 60_000,
  onOutput?: CommandOutput,
  signal?: AbortSignal,
  environment = providerEnvironment(process.env),
  policy: SandboxPolicy = DISABLED_SANDBOX_POLICY,
  dependencies: CommandDependencies = {},
): Promise<CommandResult> {
  const rendered = renderCommand(template, prompt);
  let invocation;
  try {
    const gitPaths = policy.mode === "required" ? await gitSandboxPaths(cwd) : { readPaths: [], writePaths: [], denyWritePaths: [] };
    invocation = await (dependencies.buildInvocation ?? buildSandboxInvocation)(rendered.executable, rendered.args, cwd, policy, { env: environment, extraReadPaths: gitPaths.readPaths, extraWritePaths: gitPaths.writePaths, denyWritePaths: gitPaths.denyWritePaths });
  } catch (error) {
    const message = error instanceof SandboxPolicyError
      ? `Sandbox ${error.category} policy prevented provider startup: ${error.message}`
      : "Sandbox policy could not prepare provider execution";
    return { code: null, stdout: "", stderr: "", error: new Error(message), policyViolation: "sandbox" };
  }

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(invocation.executable, invocation.args, { cwd, shell: false, env: environment, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error: error instanceof Error ? error : new Error("Provider process could not start") });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let policyViolation: PolicyViolation | undefined;
    let settled = false;
    let outputBytes = 0;
    const effectiveTimeout = Math.min(timeoutMs, policy.runtimeMs);
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(resourceTimer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const stop = () => {
      stopProcessTree(child, "SIGTERM");
      const force = setTimeout(() => stopProcessTree(child, "SIGKILL"), 2_000);
      force.unref?.();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, effectiveTimeout);
    timer.unref?.();
    let checkingResources = false;
    const resourceTimer = setInterval(() => {
      if (!child.pid || checkingResources || settled) return;
      checkingResources = true;
      void (dependencies.processGroupUsage ?? processGroupUsage)(child.pid).then((usage) => {
        if (settled) return;
        if (!usage) policyViolation = "sandbox";
        else if (usage.processes > policy.maxProcesses) policyViolation = "process";
        else if (usage.memoryKb > policy.memoryMb * 1024) policyViolation = "memory";
        if (policyViolation) stop();
      }).finally(() => { checkingResources = false; });
    }, 100);
    if (policy.mode === "disabled") clearInterval(resourceTimer);
    resourceTimer.unref?.();
    const abort = () => { cancelled = true; stop(); };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = Math.max(0, policy.maxOutputBytes - outputBytes);
      const accepted = chunk.subarray(0, remaining);
      outputBytes += accepted.byteLength;
      const text = accepted.toString();
      if (stream === "stdout") stdout += text; else stderr += text;
      if (text) onOutput?.(stream, text);
      if (accepted.byteLength < chunk.byteLength && !policyViolation) {
        policyViolation = "output";
        stop();
      }
    };
    child.stdout!.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => finish({ code: null, stdout, stderr, error, timedOut, cancelled, policyViolation }));
    child.on("close", (code, closeSignal) => {
      policyViolation ??= inferViolation(closeSignal, stderr);
      const error = policyViolation === "output" ? new Error(`Provider output exceeded the ${policy.maxOutputBytes}-byte sandbox limit`) : undefined;
      finish({ code, stdout, stderr, error, timedOut, cancelled, policyViolation });
    });
  });
}
