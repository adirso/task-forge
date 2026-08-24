export type ProviderLabel = "claude" | "codex" | "cursor";

export interface ProviderConfig {
  cmd: string;
  repo: string;
  webhookSecret: string;
  apiToken: string;
}

export interface SmithyConfig {
  host: string;
  port: number;
  apiUrl: string;
  providers: Partial<Record<ProviderLabel, ProviderConfig>>;
}

function jsonObject(name: string): Record<string, unknown> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error instanceof Error ? error.message : "invalid value"}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SmithyConfig {
  const providerValues = jsonObject("SMITHY_PROVIDERS");
  const providers: Partial<Record<ProviderLabel, ProviderConfig>> = {};
  for (const label of ["claude", "codex", "cursor"] as const) {
    const raw = providerValues[label];
    if (!raw) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`SMITHY_PROVIDERS.${label} must be an object`);
    const value = raw as Record<string, unknown>;
    for (const field of ["cmd", "repo", "webhookSecret", "apiToken"] as const) if (typeof value[field] !== "string" || !value[field]) throw new Error(`SMITHY_PROVIDERS.${label}.${field} is required`);
    providers[label] = { cmd: value.cmd as string, repo: value.repo as string, webhookSecret: value.webhookSecret as string, apiToken: value.apiToken as string };
  }
  return { host: env.SMITHY_HOST ?? "127.0.0.1", port: Number(env.SMITHY_PORT ?? 4500), apiUrl: (env.TASKFORGE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""), providers };
}
