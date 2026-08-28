import { loadDeliveryMonitorConfig, monitorDatabaseConfig } from "./config.js";
import { SqliteMonitorStore, MysqlMonitorStore } from "./persistence.js";
import { runWorker, runSweep, type MonitorItem, type PollResult } from "./worker.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export * from "./persistence.js";
export * from "./worker.js";

const config = loadDeliveryMonitorConfig();
const database = monitorDatabaseConfig();
if (database.driver === "sqlite") mkdirSync(dirname(database.path || "./data/taskforge.db"), { recursive: true });
const store = database.driver === "mysql" ? new MysqlMonitorStore(database.url || "") : new SqliteMonitorStore(database.path || "./data/taskforge.db");
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());

function configuredItems(): MonitorItem[] {
  if (!process.env.DELIVERY_MONITOR_ITEMS_JSON) return [];
  const parsed: unknown = JSON.parse(process.env.DELIVERY_MONITOR_ITEMS_JSON);
  if (!Array.isArray(parsed)) throw new Error("DELIVERY_MONITOR_ITEMS_JSON must be an array");
  return parsed as MonitorItem[];
}
async function pollGithub(item: MonitorItem): Promise<PollResult> {
  const response = await fetch(item.pullRequestUrl.replace("github.com", "api.github.com/repos").replace("/pull/", "/pulls/"), { headers: { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  const body = await response.json() as { state: "open" | "closed"; merged_at: string | null; draft: boolean; head?: { sha?: string } };
  return { state: body.merged_at ? "MERGED" : body.state.toUpperCase(), observedAt: new Date().toISOString(), etag: response.headers.get("etag"), cursor: null };
}
const options = { store, ownerId: process.env.DELIVERY_MONITOR_OWNER_ID ?? `monitor-${process.pid}`, config, list: async (_cursor: string | null, limit: number) => configuredItems().slice(0, limit), poll: pollGithub, onError: (category: string) => process.stderr.write(`Delivery Monitor error: ${category}\n`), onAudit: (event: string) => process.stdout.write(JSON.stringify({ event, observedAt: new Date().toISOString() }) + "\n") };

// The list/poll callbacks are supplied by the API integration in the next layer;
// this entrypoint still owns migration, lifecycle, and lease-safe worker startup.
if (config.enabled && !process.argv.includes("--once")) {
  runWorker(options, abort.signal)
    .catch((error) => { process.stderr.write("Delivery Monitor failed to start: worker error\n"); process.exitCode = 1; });
} else if (process.argv.includes("--once")) {
  store.migrate().then(() => runSweep(options)).then(() => store.close()).catch(() => { process.stderr.write("Delivery Monitor failed to initialize storage\n"); process.exitCode = 1; });
}
