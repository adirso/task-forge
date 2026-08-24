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

export interface CommandResult { code: number | null; stdout: string; stderr: string; error?: Error; }

export function executeCommand(template: string, prompt: string, cwd: string, timeoutMs = 30 * 60_000): Promise<CommandResult> {
  const { executable, args } = renderCommand(template, prompt);
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr, error }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
