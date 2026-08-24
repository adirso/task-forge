/** Provider names are routing labels; Smithy does not contain provider-specific code. */
export type ProviderLabel = string;

export interface ProviderConfig {
  cmd: string;
  repo?: string;
  webhookSecret: string;
  apiToken: string;
}

export interface SmithyConfig {
  host: string;
  port: number;
  apiUrl: string;
  dbPath: string;
  providers: Record<ProviderLabel, ProviderConfig>;
}

function jsonObject(name: string, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const raw = env[name];
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
  const providerValues = jsonObject("SMITHY_PROVIDERS", env);
  const providers: Record<ProviderLabel, ProviderConfig> = {};
  for (const [label, raw] of Object.entries(providerValues)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(label)) throw new Error(`SMITHY_PROVIDERS.${label} must be a safe provider label`);
    if (!raw) continue;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error(`SMITHY_PROVIDERS.${label} must be an object`);
    const value = raw as Record<string, unknown>;
    for (const field of ["cmd", "webhookSecret", "apiToken"] as const) if (typeof value[field] !== "string" || !value[field]) throw new Error(`SMITHY_PROVIDERS.${label}.${field} is required`);
    if (value.repo !== undefined && (typeof value.repo !== "string" || !value.repo)) throw new Error(`SMITHY_PROVIDERS.${label}.repo must be a non-empty path when provided`);
    providers[label] = { cmd: value.cmd as string, repo: value.repo as string | undefined, webhookSecret: value.webhookSecret as string, apiToken: value.apiToken as string };
  }
  const host = env.SMITHY_HOST ?? "127.0.0.1";
  if (!(["127.0.0.1", "::1", "localhost"] as string[]).includes(host)) throw new Error("Smithy must bind to loopback; non-loopback SMITHY_HOST is not allowed");
  return { host, port: Number(env.SMITHY_PORT ?? 4500), apiUrl: (env.TASKFORGE_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""), dbPath: env.SMITHY_DB_PATH ?? "./data/smithy.sqlite", providers };
}
