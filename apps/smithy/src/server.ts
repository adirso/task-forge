import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { SmithyRunner } from "./runner.js";
import { ApiClient } from "./api.js";
import { SqliteJobStore } from "./store.js";
import { prepareWorktree } from "./worktree.js";
import { runProviderPreflight } from "./preflight.js";
import { verifySignature } from "./security.js";

export function createSmithyServer(config = loadConfig(), runner = new SmithyRunner(config.providers, (provider) => new ApiClient(config.apiUrl, provider.apiToken), undefined, undefined, new SqliteJobStore(config.dbPath), prepareWorktree, undefined, config.apiUrl, config.sandbox)) {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/providers") {
      void runProviderPreflight(config.providers, undefined, config.sandbox).then((providers) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ enabled: true, providers })); }).catch(() => { response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ enabled: true, providers: [], error: "Provider health checks failed" })); });
      return;
    }
    const cancelMatch = request.method === "POST" ? request.url?.match(/^\/jobs\/([^/]+)\/cancel$/) : null;
    if (cancelMatch) {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 4096) chunks.push(chunk);
        else tooLarge = true;
      });
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const signature = request.headers["x-taskforge-signature"];
        const header = Array.isArray(signature) ? signature[0] : signature;
        let eventId: unknown;
        try { eventId = (JSON.parse(body) as { eventId?: unknown }).eventId; } catch { /* Unauthorized requests get a generic response. */ }
        let pathEventId: string | undefined;
        try { pathEventId = decodeURIComponent(cancelMatch[1]!); } catch { /* Invalid path encoding is unauthorized. */ }
        if (tooLarge || !config.cancelSecret || !verifySignature(config.cancelSecret, header, body) || typeof eventId !== "string" || eventId !== pathEventId) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        const cancelled = runner.cancel(pathEventId);
        response.writeHead(cancelled ? 200 : 404, { "Content-Type": "application/json" });
        response.end(JSON.stringify(cancelled ? { cancelled: true, eventId: pathEventId } : { error: "Job is not cancellable" }));
      });
      return;
    }
    const forceMatch = request.method === "POST" ? request.url?.match(/^\/agents\/([^/]+)\/force-cycle$/) : null;
    if (forceMatch) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", async () => {
        const signature = request.headers["x-taskforge-signature"];
        const result = await runner.forceCycle(forceMatch[1]!, { "x-taskforge-signature": Array.isArray(signature) ? signature[0] : signature }, Buffer.concat(chunks).toString("utf8"));
        response.writeHead(result.status, { "Content-Type": "application/json" }); response.end(result.body);
      });
      return;
    }
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
