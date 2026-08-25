import { loadConfig } from "./config.js";
import { createSmithyServer } from "./server.js";
import { loadEnvFile } from "./env-file.js";
import { runProviderPreflight } from "./preflight.js";

const envFile = process.env.SMITHY_ENV_FILE ?? ".env.smithy";
if (!loadEnvFile(envFile)) loadEnvFile(".env");
const config = loadConfig();
const server = createSmithyServer(config);
server.listen(config.port, config.host, () => {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const baseUrl = `http://${host}:${config.port}`;
  console.log(`Smithy listening on ${baseUrl}`);
  const providers = Object.keys(config.providers);
  if (!providers.length) {
    console.log("No providers configured. Run: npm run configure -w @taskforge/smithy -- --file .env");
    return;
  }
  console.log("Webhook URLs (configure these in TaskForge Settings > Agents):");
  for (const provider of providers) console.log(`  ${provider}: ${baseUrl}/agents/${encodeURIComponent(provider)}`);
  if (config.preflight) {
    void runProviderPreflight(config.providers).then((health) => {
      console.log("Provider preflight diagnostics (credentials and secrets are redacted):");
      for (const result of health) console.log(`  ${result.provider}: ${result.status} — ${result.message}`);
      console.log(`  Health endpoint: ${baseUrl}/health/providers`);
    });
  } else {
    console.log("Provider preflight checks are disabled. Set SMITHY_PREFLIGHT=true to enable startup diagnostics or query /health/providers.");
  }
});
