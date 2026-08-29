import { readFile } from "node:fs/promises";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  const text = String(value ?? "").trim();
  const match = VERSION.exec(text);
  if (!match) throw new Error(`Invalid semantic version: ${text || "(empty)"}`);
  return match.slice(1).map(Number);
}

export function isVersionIncreased(candidate, base) {
  const next = parseVersion(candidate);
  const previous = parseVersion(base);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] > previous[index]) return true;
    if (next[index] < previous[index]) return false;
  }
  return false;
}

export function assertVersionIncreased(candidate, base) {
  if (!isVersionIncreased(candidate, base)) throw new Error(`Version ${candidate} must be greater than base version ${base}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE_VERSION;
  if (!base) { console.error("BASE_VERSION is required"); process.exit(2); }
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  try { assertVersionIncreased(manifest.version, base); console.log(`Version guard passed: ${base} -> ${manifest.version}`); }
  catch (error) { console.error(error instanceof Error ? error.message : "Version guard failed"); process.exit(1); }
}
