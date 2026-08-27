import { loadDeliveryMonitorConfig } from "./config.js";
export * from "./persistence.js";
export * from "./worker.js";

const config = loadDeliveryMonitorConfig();
if (process.argv.includes("--once")) process.stdout.write(`Delivery Monitor configured (poll=${config.pollIntervalMs}ms, batch=${config.batchSize})\n`);
else if (config.enabled) process.stdout.write(`Delivery Monitor running (poll=${config.pollIntervalMs}ms, batch=${config.batchSize})\n`);
