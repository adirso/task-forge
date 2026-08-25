import { spawn } from "node:child_process";

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

export interface CommandResult { code: number | null; stdout: string; stderr: string; error?: Error; timedOut?: boolean; cancelled?: boolean; }
export type CommandOutput = (stream: "stdout" | "stderr", chunk: string) => void;

export function executeCommand(template: string, prompt: string, cwd: string, timeoutMs = 30 * 60_000, onOutput?: CommandOutput, signal?: AbortSignal): Promise<CommandResult> {
  const { executable, args } = renderCommand(template, prompt);
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, shell: false, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    const abort = () => { cancelled = true; child.kill("SIGTERM"); };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { const text = chunk.toString(); stdout += text; onOutput?.("stdout", text); });
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); stderr += text; onOutput?.("stderr", text); });
    child.on("error", (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve({ code: null, stdout, stderr, error, timedOut, cancelled }); });
    child.on("close", (code) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve({ code, stdout, stderr, timedOut, cancelled }); });
  });
}
