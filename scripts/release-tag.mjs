import { readFile } from "node:fs/promises";
import { parseVersion } from "./check-version.mjs";

export function tagForVersion(version) {
  parseVersion(version);
  return `v${String(version).trim()}`;
}

export function decideTag(version, commitSha, existingSha = null) {
  const tag = tagForVersion(version);
  if (existingSha && existingSha !== commitSha) throw new Error(`Tag ${tag} already points to a different commit`);
  return { tag, action: existingSha ? "already-present" : "create" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  try { console.log(tagForVersion(manifest.version)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Invalid release version"); process.exit(1); }
}
