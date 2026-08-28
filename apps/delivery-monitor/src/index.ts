import { loadDeliveryMonitorConfig, monitorDatabaseConfig } from "./config.js";
import { SqliteMonitorStore, MysqlMonitorStore } from "./persistence.js";
import { runWorker, runSweep, type MonitorItem, type PollResult } from "./worker.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { syncTask } from "./sync.js";
import { createGithubInstallationToken, fetchGithubPullRequest } from "./github.js";
export * from "./persistence.js";
export * from "./worker.js";
export * from "./github.js";
export * from "./sync.js";

const config = loadDeliveryMonitorConfig();
const database = monitorDatabaseConfig();
if (database.driver === "sqlite") mkdirSync(dirname(database.path || "./data/taskforge.db"), { recursive: true });
const store = database.driver === "mysql" ? new MysqlMonitorStore(database.url || "") : new SqliteMonitorStore(database.path || "./data/taskforge.db");
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());
process.once("SIGTERM", () => abort.abort());

function configuredItems(): MonitorItem[] {
  if (process.env.TASKFORGE_API_URL && process.env.TASKFORGE_PROJECT_ID) return [];
  if (!process.env.DELIVERY_MONITOR_ITEMS_JSON) return [];
  const parsed: unknown = JSON.parse(process.env.DELIVERY_MONITOR_ITEMS_JSON);
  if (!Array.isArray(parsed)) throw new Error("DELIVERY_MONITOR_ITEMS_JSON must be an array");
  return parsed as MonitorItem[];
}
async function taskforgeRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${process.env.TASKFORGE_API_URL}${path}`, { ...init, headers: { accept: "application/json", authorization: `Bearer ${process.env.TASKFORGE_TOKEN ?? ""}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`TaskForge API request failed (${response.status})`);
  return response.json() as Promise<any>;
}
async function listTaskforgeItems(limit: number): Promise<MonitorItem[]> {
  if (!process.env.TASKFORGE_API_URL || !process.env.TASKFORGE_PROJECT_ID) return configuredItems().slice(0, limit);
  const project = await taskforgeRequest(`/api/projects/${process.env.TASKFORGE_PROJECT_ID}`);
  const approvalStatus = project.project?.agentWorkflow?.approved ?? "APPROVED";
  const result = await taskforgeRequest(`/api/projects/${process.env.TASKFORGE_PROJECT_ID}/tasks?status=${approvalStatus}&limit=${limit}`);
  return (result.tasks ?? []).filter((task: any) => task.pullRequestUrl).map((task: any) => ({ runId: task.runId ?? task.id, taskId: task.id, pullRequestUrl: task.pullRequestUrl, status: task.status, approvalStatus, availableStatuses: project.project?.availableStatuses ?? [] }));
}
let githubToken: string | undefined = process.env.GITHUB_TOKEN;
async function pollGithub(item: MonitorItem, checkpoint: any): Promise<PollResult> {
  if (!githubToken && config.githubAppId && config.githubInstallationId && config.githubPrivateKey) githubToken = await createGithubInstallationToken({ appId: config.githubAppId, installationId: config.githubInstallationId, privateKey: config.githubPrivateKey });
  const result = await fetchGithubPullRequest(item.pullRequestUrl, githubToken, fetch, checkpoint?.etag);
  return { state: result.state, observedAt: new Date().toISOString(), etag: result.etag, cursor: null };
}
const options = { store, ownerId: process.env.DELIVERY_MONITOR_OWNER_ID ?? `monitor-${process.pid}`, config, list: async (_cursor: string | null, limit: number) => listTaskforgeItems(limit), poll: pollGithub, onResult: async (item: MonitorItem, result: PollResult) => { if (!process.env.TASKFORGE_API_URL) return; await syncTask({ id: item.taskId, runId: item.runId, status: item.status ?? "", approvalStatus: item.approvalStatus ?? "APPROVED", pullRequestUrl: item.pullRequestUrl, availableStatuses: item.availableStatuses ?? [] }, { fetchPullRequest: async () => ({ state: result.state as any, headSha: null, etag: result.etag ?? null }), updateTask: async (patch) => taskforgeRequest(`/api/tasks/${item.taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }), recordActivity: async ({ state, errorCategory, runId }) => { const detail = errorCategory ? `Synchronization failed (${errorCategory})` : `GitHub pull request observed as ${state}`; await taskforgeRequest(`/api/tasks/${item.taskId}/updates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: `Delivery Monitor [run ${runId}]: ${detail}.` }) }); } }); }, onError: (category: string) => process.stderr.write(`Delivery Monitor error: ${category}\n`), onAudit: (event: string, item?: MonitorItem) => process.stdout.write(JSON.stringify({ event, taskId: item?.taskId, runId: item?.runId, observedAt: new Date().toISOString() }) + "\n") };

// The list/poll callbacks are supplied by the API integration in the next layer;
// this entrypoint still owns migration, lifecycle, and lease-safe worker startup.
if (config.enabled && !process.argv.includes("--once")) {
  runWorker(options, abort.signal)
    .catch((error) => { process.stderr.write("Delivery Monitor failed to start: worker error\n"); process.exitCode = 1; });
} else if (process.argv.includes("--once")) {
  store.migrate().then(() => runSweep(options)).then(() => store.close()).catch(() => { process.stderr.write("Delivery Monitor failed to initialize storage\n"); process.exitCode = 1; });
}
