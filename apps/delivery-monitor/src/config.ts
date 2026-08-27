import { deliveryMonitorConfigSchema, type DeliveryMonitorConfig } from "@taskforge/contracts";

export function loadDeliveryMonitorConfig(env: NodeJS.ProcessEnv = process.env): DeliveryMonitorConfig {
  const parseNumber = (name: string) => env[name] === undefined ? undefined : Number(env[name]);
  return deliveryMonitorConfigSchema.parse({
    enabled: env.DELIVERY_MONITOR_ENABLED !== "false",
    githubAppId: env.GITHUB_APP_ID,
    githubInstallationId: env.GITHUB_INSTALLATION_ID,
    githubPrivateKey: env.GITHUB_PRIVATE_KEY,
    pollIntervalMs: parseNumber("DELIVERY_MONITOR_POLL_INTERVAL_MS"),
    batchSize: parseNumber("DELIVERY_MONITOR_BATCH_SIZE"),
    leaseDurationMs: parseNumber("DELIVERY_MONITOR_LEASE_DURATION_MS"),
  });
}
