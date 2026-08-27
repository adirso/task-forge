import { loadDeliveryMonitorConfig, monitorDatabaseConfig } from "./config.js";
import { SqliteMonitorStore, MysqlMonitorStore } from "./persistence.js";
import { runWorker } from "./worker.js";
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

// The list/poll callbacks are supplied by the API integration in the next layer;
// this entrypoint still owns migration, lifecycle, and lease-safe worker startup.
if (config.enabled && !process.argv.includes("--once")) {
  runWorker({ store, ownerId: process.env.DELIVERY_MONITOR_OWNER_ID ?? `monitor-${process.pid}`, config, list: async () => [], poll: async () => ({ state: "OPEN", observedAt: new Date().toISOString() }) }, abort.signal)
    .catch((error) => { process.stderr.write("Delivery Monitor failed to start: worker error\n"); process.exitCode = 1; });
} else if (process.argv.includes("--once")) {
  store.migrate().then(() => store.close()).catch(() => { process.stderr.write("Delivery Monitor failed to initialize storage\n"); process.exitCode = 1; });
}
