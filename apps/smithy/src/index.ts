import { loadConfig } from "./config.js";
import { createSmithyServer } from "./server.js";

const config = loadConfig();
const server = createSmithyServer(config);
server.listen(config.port, config.host, () => console.log(`Smithy listening on http://${config.host}:${config.port}`));
