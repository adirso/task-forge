import { access, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface SmithyProviderValues {
  cmd: string;
  webhookSecret: string;
  apiToken: string;
  repo?: string;
}

/** Read only the JSON provider setting, without logging or exposing credentials. */
export async function readProviders(file: string): Promise<Record<string, SmithyProviderValues>> {
  try { await access(file); } catch { return {}; }
  const source = await readFile(file, "utf8");
  const match = source.match(/^\s*SMITHY_PROVIDERS\s*=\s*(.*)$/m);
  if (!match) return {};
  const raw = (match[1] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("must be an object");
    return value as Record<string, SmithyProviderValues>;
  } catch (error) {
    throw new Error(`SMITHY_PROVIDERS in ${file} is not valid JSON: ${error instanceof Error ? error.message : "invalid value"}`);
  }
}

function envValue(providers: Record<string, SmithyProviderValues>): string {
  // Keep the value on one line and quote it so spaces in command templates survive dotenv parsing.
  return `SMITHY_PROVIDERS='${JSON.stringify(providers).replaceAll("'", "\\'")}'`;
}

/** Update only SMITHY_PROVIDERS, preserving all other .env lines and comments. */
export async function writeProviders(file: string, providers: Record<string, SmithyProviderValues>): Promise<void> {
  let source = "";
  try { source = await readFile(file, "utf8"); } catch { /* create below */ }
  const line = envValue(providers);
  if (/^\s*SMITHY_PROVIDERS\s*=.*$/m.test(source)) {
    source = source.replace(/^\s*SMITHY_PROVIDERS\s*=.*$/m, line);
  } else {
    source = `${source.replace(/\s*$/, "")}${source ? "\n" : ""}${line}\n`;
  }
  await writeFile(file, source, { encoding: "utf8", mode: 0o600 });
}

export function defaultEnvFile(cwd = process.cwd()): string {
  return path.join(cwd, ".env");
}

/** Load a small dotenv subset without replacing values explicitly exported by the operator. */
export function loadEnvFile(file: string, target: NodeJS.ProcessEnv = process.env): boolean {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    const key = match?.[1];
    if (!key || target[key] !== undefined) continue;
    let value = match[2] ?? "";
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    target[key] = value;
  }
  return true;
}
