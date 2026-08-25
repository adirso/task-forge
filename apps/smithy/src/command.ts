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

export interface CommandResult { code: number | null; stdout: string; stderr: string; error?: Error; timedOut?: boolean; }

export type CommandOutput = (stream: "stdout" | "stderr", chunk: string) => void;

export function executeCommand(template: string, prompt: string, cwd: string, timeoutMs = 30 * 60_000, onOutput?: CommandOutput): Promise<CommandResult> {
  const { executable, args } = renderCommand(template, prompt);
  return new Promise((resolve) => {
    // Providers must run unattended. A piped stdin can leave a CLI waiting
    // forever for a permission/login answer that Smithy cannot provide.
    const child = spawn(executable, args, { cwd, shell: false, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { const text = chunk.toString(); stdout += text; onOutput?.("stdout", text); });
    child.stderr.on("data", (chunk: Buffer) => { const text = chunk.toString(); stderr += text; onOutput?.("stderr", text); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr, error, timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}
