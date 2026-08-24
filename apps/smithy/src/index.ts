import { loadConfig } from "./config.js";
import { createSmithyServer } from "./server.js";

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
});
