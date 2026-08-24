import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { SmithyRunner } from "./runner.js";
import { ApiClient } from "./api.js";
import { SqliteJobStore } from "./store.js";
import { prepareWorktree } from "./worktree.js";

export function createSmithyServer(config = loadConfig(), runner = new SmithyRunner(config.providers, (provider) => new ApiClient(config.apiUrl, provider.apiToken), undefined, undefined, new SqliteJobStore(config.dbPath), prepareWorktree)) {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.startsWith("/agents/")) { response.writeHead(404); response.end(JSON.stringify({ error: "Not found" })); return; }
    const provider = request.url.slice("/agents/".length).split("/")[0] ?? "";
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const signature = request.headers["x-taskforge-signature"];
      const result = await runner.handle(provider, { "x-taskforge-signature": Array.isArray(signature) ? signature[0] : signature }, Buffer.concat(chunks).toString("utf8"));
      response.writeHead(result.status, { "Content-Type": "application/json" }); response.end(result.body);
    });
  });
  void runner.resume();
  return server;
}
