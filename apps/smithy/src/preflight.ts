import type { ProviderConfig, ProviderLabel } from "./config.js";
import { executeCommand, renderCommand, type CommandResult } from "./command.js";
import { redact } from "./security.js";

export type ProviderHealthStatus = "OK" | "MISSING" | "UNAUTHENTICATED" | "PERMISSION_DENIED" | "FAILED";
export interface ProviderHealth {
  provider: ProviderLabel;
  status: ProviderHealthStatus;
  message: string;
  checkedAt: string;
}

function safeOutput(result: CommandResult): string {
  return redact(`${result.stderr}\n${result.stdout}`).replace(/\s+/g, " ").trim().slice(0, 240);
}

function diagnostic(result: CommandResult): { status: ProviderHealthStatus; message: string } {
  const errorCode = result.error && (result.error as NodeJS.ErrnoException).code;
  const output = safeOutput(result);
  if (errorCode === "ENOENT") return { status: "MISSING", message: "Provider command was not found. Install the configured binary or update its command template." };
  if (errorCode === "EACCES" || /permission denied|operation not permitted/i.test(output)) return { status: "PERMISSION_DENIED", message: "Provider command permission was denied. Check executable and repository permissions." };
  if (/unauthori[sz]ed|not authenticated|authentication required|login required|invalid (api )?key|invalid token|credential/i.test(output)) return { status: "UNAUTHENTICATED", message: `Provider authentication is missing or invalid${output ? `: ${output}` : ". Run the provider login flow and retry."}` };
  if (result.timedOut) return { status: "FAILED", message: "Provider health check timed out. Check the command and local provider installation." };
  return { status: "FAILED", message: `Provider health check failed${output ? `: ${output}` : ". Check the command template and local installation."}` };
}

export async function checkProvider(provider: ProviderLabel, config: ProviderConfig, execute = executeCommand, now = () => new Date().toISOString()): Promise<ProviderHealth> {
  let command: string;
  try {
    const executable = renderCommand(config.cmd, "").executable;
    command = config.healthCmd?.trim() || `${executable} --version`;
    renderCommand(command, "");
    const result = await execute(command, "", config.repo || process.cwd(), 10_000);
    if (result.code === 0) return { provider, status: "OK", message: "Provider command is installed and responded successfully.", checkedAt: now() };
    const failure = diagnostic(result);
    return { provider, ...failure, checkedAt: now() };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Invalid provider health command").slice(0, 240);
    return { provider, status: "FAILED", message: `Provider health check could not run: ${message}`, checkedAt: now() };
  }
}

export async function runProviderPreflight(providers: Partial<Record<ProviderLabel, ProviderConfig>>, execute = executeCommand): Promise<ProviderHealth[]> {
  return Promise.all(Object.entries(providers).map(([provider, config]) => config ? checkProvider(provider, config, execute) : Promise.resolve({ provider, status: "FAILED" as const, message: "Provider configuration is empty.", checkedAt: new Date().toISOString() })));
}
