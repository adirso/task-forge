import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";

export type SandboxMode = "required" | "disabled";
export type SandboxBackend = "auto" | "sandbox-exec" | "bwrap";

export interface SandboxPolicy {
  mode: SandboxMode;
  backend: SandboxBackend;
  readPaths: string[];
  writePaths: string[];
  networkAllow: string[];
  environmentAllow: string[];
  cpuSeconds: number;
  memoryMb: number;
  runtimeMs: number;
  maxProcesses: number;
  maxOutputBytes: number;
}

export const DEFAULT_SANDBOX_POLICY: Readonly<SandboxPolicy> = Object.freeze({
  mode: "required",
  backend: "auto",
  readPaths: [],
  writePaths: [],
  // Autonomous delivery needs TaskForge, GitHub, and dependency registries. An
  // operator can replace this explicit wildcard with a backend-supported list.
  networkAllow: ["*"],
  environmentAllow: [],
  cpuSeconds: 30 * 60,
  memoryMb: 4_096,
  runtimeMs: 30 * 60_000,
  maxProcesses: 64,
  maxOutputBytes: 5 * 1024 * 1024,
});

export const DISABLED_SANDBOX_POLICY: Readonly<SandboxPolicy> = Object.freeze({
  ...DEFAULT_SANDBOX_POLICY,
  mode: "disabled",
});

export class SandboxPolicyError extends Error {
  constructor(readonly category: "configuration" | "backend" | "filesystem" | "network", message: string) {
    super(message);
    this.name = "SandboxPolicyError";
  }
}

const integer = (value: unknown, fallback: number, name: string, minimum: number, maximum: number) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new SandboxPolicyError("configuration", `${name} must be an integer between ${minimum} and ${maximum}`);
  return number;
};

function strings(value: unknown, fallback: readonly string[], name: string) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new SandboxPolicyError("configuration", `${name} must be an array of non-empty strings`);
  return [...new Set(value.map((item) => item.trim()))];
}

function policyPath(value: string, home: string | undefined, name: string) {
  const expanded = value === "~" ? home : value.startsWith("~/") && home ? path.join(home, value.slice(2)) : value;
  if (!expanded || !path.isAbsolute(expanded)) throw new SandboxPolicyError("configuration", `${name} entries must be absolute paths (or start with ~/ when HOME is set)`);
  const normalized = path.resolve(expanded);
  if (normalized === path.parse(normalized).root) throw new SandboxPolicyError("configuration", `${name} cannot allow an entire filesystem root`);
  return normalized;
}

export function parseSandboxPolicy(raw: string | undefined, home = process.env.HOME): SandboxPolicy {
  let value: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
      value = parsed as Record<string, unknown>;
    } catch (error) {
      throw new SandboxPolicyError("configuration", `SMITHY_SANDBOX_POLICY must be valid JSON: ${error instanceof Error ? error.message : "invalid value"}`);
    }
  }
  const mode = value.mode ?? DEFAULT_SANDBOX_POLICY.mode;
  if (mode !== "required" && mode !== "disabled") throw new SandboxPolicyError("configuration", "sandbox mode must be required or disabled");
  const backend = value.backend ?? DEFAULT_SANDBOX_POLICY.backend;
  if (backend !== "auto" && backend !== "sandbox-exec" && backend !== "bwrap") throw new SandboxPolicyError("configuration", "sandbox backend must be auto, sandbox-exec, or bwrap");
  const readPaths = strings(value.readPaths, DEFAULT_SANDBOX_POLICY.readPaths, "readPaths").map((entry) => policyPath(entry, home, "readPaths"));
  const writePaths = strings(value.writePaths, DEFAULT_SANDBOX_POLICY.writePaths, "writePaths").map((entry) => policyPath(entry, home, "writePaths"));
  const networkAllow = strings(value.networkAllow, DEFAULT_SANDBOX_POLICY.networkAllow, "networkAllow");
  if (networkAllow.includes("*") && networkAllow.length !== 1) throw new SandboxPolicyError("configuration", "networkAllow wildcard must be the only entry");
  if (networkAllow.some((entry) => {
    if (entry === "*") return false;
    const match = entry.match(/^(?:[A-Za-z0-9*.-]+|\[[0-9A-Fa-f:]+\]):(\*|\d{1,5})$/);
    return !match || match[1] !== "*" && (Number(match[1]) < 1 || Number(match[1]) > 65_535);
  })) throw new SandboxPolicyError("configuration", "networkAllow entries must be valid host:port or [IPv6]:port patterns");
  const environmentAllow = strings(value.environmentAllow, DEFAULT_SANDBOX_POLICY.environmentAllow, "environmentAllow");
  if (environmentAllow.some((entry) => !/^[A-Z_][A-Z0-9_]*$/.test(entry))) throw new SandboxPolicyError("configuration", "environmentAllow entries must be uppercase environment variable names");
  if (environmentAllow.some((entry) => /^SMITHY_|^TASKFORGE_|WEBHOOK/i.test(entry))) throw new SandboxPolicyError("configuration", "Smithy, TaskForge, and webhook variables cannot be inherited by provider processes");
  return {
    mode,
    backend,
    readPaths,
    writePaths,
    networkAllow,
    environmentAllow,
    cpuSeconds: integer(value.cpuSeconds, DEFAULT_SANDBOX_POLICY.cpuSeconds, "cpuSeconds", 1, 86_400),
    memoryMb: integer(value.memoryMb, DEFAULT_SANDBOX_POLICY.memoryMb, "memoryMb", 64, 131_072),
    runtimeMs: integer(value.runtimeMs, DEFAULT_SANDBOX_POLICY.runtimeMs, "runtimeMs", 1_000, 86_400_000),
    maxProcesses: integer(value.maxProcesses, DEFAULT_SANDBOX_POLICY.maxProcesses, "maxProcesses", 1, 4_096),
    maxOutputBytes: integer(value.maxOutputBytes, DEFAULT_SANDBOX_POLICY.maxOutputBytes, "maxOutputBytes", 1_024, 100 * 1024 * 1024),
  };
}

export interface SandboxInvocation {
  executable: string;
  args: string[];
  backend: Exclude<SandboxBackend, "auto"> | "disabled";
}

type InvocationOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  extraReadPaths?: string[];
  extraWritePaths?: string[];
  resolveExecutable?: (executable: string) => Promise<string | null>;
  pathExists?: (candidate: string) => Promise<boolean>;
};

async function executableOnPath(executable: string, cwd: string, env: NodeJS.ProcessEnv) {
  const candidates = executable.includes(path.sep)
    ? [path.resolve(cwd, executable)]
    : (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, executable));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* keep searching */ }
  }
  return null;
}

const exists = async (candidate: string) => { try { await access(candidate); return true; } catch { return false; } };
const quote = (value: string) => JSON.stringify(value);
const uniquePaths = (values: string[]) => [...new Set(values.map((value) => path.resolve(value)))].sort((left, right) => left.length - right.length);

function macProfile(cwd: string, executable: string, policy: SandboxPolicy, extraReadPaths: string[], extraWritePaths: string[]) {
  const readPaths = uniquePaths(["/System", "/usr", "/bin", "/sbin", "/Library", "/private/etc", path.dirname(executable), cwd, ...policy.readPaths, ...extraReadPaths]);
  const writePaths = uniquePaths([cwd, process.env.TMPDIR ?? "/private/tmp", ...policy.writePaths, ...extraWritePaths]);
  const network = policy.networkAllow.length === 0
    ? []
    : policy.networkAllow[0] === "*"
      ? ["(allow network-outbound)"]
      : policy.networkAllow.map((entry) => `(allow network-outbound (remote tcp ${quote(entry)}))`);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read-metadata)",
    `(allow file-read* ${readPaths.map((entry) => `(subpath ${quote(entry)})`).join(" ")})`,
    `(allow file-write* ${writePaths.map((entry) => `(subpath ${quote(entry)})`).join(" ")})`,
    ...network,
  ].join(" ");
}

export async function buildSandboxInvocation(executable: string, args: string[], cwd: string, policy: SandboxPolicy, options: InvocationOptions = {}): Promise<SandboxInvocation> {
  if (policy.mode === "disabled") return { executable, args, backend: "disabled" };
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolve = options.resolveExecutable ?? ((name: string) => executableOnPath(name, cwd, env));
  const pathExists = options.pathExists ?? exists;
  const providerExecutable = await resolve(executable);
  if (!providerExecutable) throw new SandboxPolicyError("backend", "Provider executable was not found before sandbox startup");
  const backend = policy.backend === "auto" ? (platform === "darwin" ? "sandbox-exec" : platform === "linux" ? "bwrap" : null) : policy.backend;
  if (!backend || (backend === "sandbox-exec" && platform !== "darwin") || (backend === "bwrap" && platform !== "linux")) throw new SandboxPolicyError("backend", "No supported sandbox backend is available for this host");
  const sandboxExecutable = await resolve(backend);
  if (!sandboxExecutable) throw new SandboxPolicyError("backend", `${backend} is required by the Smithy sandbox policy but is not installed`);
  const extraReadPaths = options.extraReadPaths ?? [];
  const extraWritePaths = options.extraWritePaths ?? [];

  if (backend === "sandbox-exec") {
    const profile = macProfile(cwd, providerExecutable, policy, extraReadPaths, extraWritePaths);
    // Darwin cannot reliably lower RLIMIT_AS for processes using its shared
    // region. CPU is enforced here; aggregate memory/process limits are
    // enforced by executeCommand's process-group watchdog.
    const limitScript = "ulimit -t \"$1\" || exit 125; shift; exec \"$@\"";
    return {
      executable: "/bin/sh",
      args: ["-c", limitScript, "smithy-limits", String(policy.cpuSeconds), sandboxExecutable, "-p", profile, providerExecutable, ...args],
      backend,
    };
  }

  if (policy.networkAllow.length > 0 && policy.networkAllow[0] !== "*") throw new SandboxPolicyError("network", "bwrap cannot enforce a host-level network allowlist; use an empty list, an explicit wildcard, or a network-filtering sandbox backend");
  const prlimit = await resolve("prlimit");
  if (!prlimit) throw new SandboxPolicyError("backend", "prlimit is required by the Linux Smithy sandbox policy but is not installed");
  const systemPaths = (await Promise.all(["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"].map(async (candidate) => await pathExists(candidate) ? candidate : null))).filter((candidate): candidate is string => Boolean(candidate));
  const readPaths = uniquePaths([...systemPaths, path.dirname(providerExecutable), ...policy.readPaths, ...extraReadPaths]);
  const writePaths = uniquePaths([cwd, ...policy.writePaths, ...extraWritePaths]);
  const bwrapArgs = ["--die-with-parent", "--new-session", "--unshare-all", ...(policy.networkAllow[0] === "*" ? ["--share-net"] : []), "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  const destinationDirectories = uniquePaths([...readPaths, ...writePaths].flatMap((entry) => {
    const values: string[] = [];
    for (let current = path.dirname(entry); current !== path.parse(current).root; current = path.dirname(current)) values.push(current);
    return values;
  }));
  for (const entry of destinationDirectories) bwrapArgs.push("--dir", entry);
  for (const entry of readPaths) bwrapArgs.push("--ro-bind", entry, entry);
  for (const entry of writePaths) bwrapArgs.push("--bind", entry, entry);
  bwrapArgs.push("--chdir", cwd, providerExecutable, ...args);
  return {
    executable: prlimit,
    args: [`--cpu=${policy.cpuSeconds}:${policy.cpuSeconds}`, `--as=${policy.memoryMb * 1024 * 1024}:${policy.memoryMb * 1024 * 1024}`, `--nproc=${policy.maxProcesses}:${policy.maxProcesses}`, "--", sandboxExecutable, ...bwrapArgs],
    backend,
  };
}
