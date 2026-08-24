import type { ProviderConfig, ProviderLabel } from "./config.js";
import { ApiClient } from "./api.js";
import { executeCommand } from "./command.js";
import { redact, verifySignature } from "./security.js";
import type { JobStore } from "./store.js";
import { MemoryJobStore } from "./store.js";

export interface AgentEvent { id: string; event: string; previousStatus?: string; task?: { id: string; number?: number; title?: string; description?: string; definitionOfDone?: string; projectKey?: string; branch?: string | null; status?: string }; runId?: string | null; }
export type RunnerResult = { status: number; body: string };
type ContextResponse = { project: { key: string; availableStatuses: string[]; localRepoPath?: string | null }; task: AgentEvent["task"] & { updates?: Array<{ body: string }> } };
type WorktreeFactory = (repo: string, branch: string | null, taskId: string) => Promise<string>;

const noopWorktree: WorktreeFactory = async (repo) => repo;

export class SmithyRunner {
  private readonly store: JobStore;
  constructor(
    private readonly providers: Partial<Record<ProviderLabel, ProviderConfig>>,
    private readonly apiFactory: (config: ProviderConfig) => ApiClient = (config) => new ApiClient(process.env.TASKFORGE_API_URL ?? "http://127.0.0.1:4000", config.apiToken),
    private readonly execute = executeCommand,
    private readonly now = () => Date.now(),
    store: JobStore = new MemoryJobStore(),
    private readonly worktree: WorktreeFactory = noopWorktree,
  ) { this.store = store; }

  async resume() { for (const job of this.store.pending()) void this.process(this.providers[job.provider as ProviderLabel], JSON.parse(job.body) as AgentEvent, job); }

  async handle(provider: string, headers: Record<string, string | undefined>, body: string): Promise<RunnerResult> {
    const config = this.providers[provider as ProviderLabel];
    if (!config) return { status: 404, body: JSON.stringify({ error: "Unknown or unconfigured agent" }) };
    if (!verifySignature(config.webhookSecret, headers["x-taskforge-signature"], body, Math.floor(this.now() / 1000))) return { status: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    let event: AgentEvent;
    try { event = JSON.parse(body) as AgentEvent; } catch { return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    if (!event.id || !event.task?.id) return { status: 400, body: JSON.stringify({ error: "Event task and id are required" }) };
    const accepted = this.store.accept(event.id, provider, event.task.id, body);
    if (accepted.duplicate) return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true }) };
    void this.process(config, event, accepted.job).catch(() => undefined);
    return { status: 202, body: JSON.stringify({ accepted: true, eventId: event.id }) };
  }

  private kind(event: AgentEvent): "IMPLEMENTATION" | "REVIEW" | "RE_REVIEW" | "FIX" {
    if (event.event === "task.status_changed") {
      if (event.task?.status === "RE_REVIEW") return "RE_REVIEW";
      if (event.task?.status === "FIX_NEEDED") return "FIX";
      if (["IN_REVIEW", "READY_FOR_REVIEW"].includes(event.task?.status ?? "")) return "REVIEW";
    }
    return "IMPLEMENTATION";
  }

  private async process(config: ProviderConfig | undefined, event: AgentEvent, job = this.store.accept(event.id, "unknown", event.task!.id, JSON.stringify(event)).job) {
    if (!config) return;
    this.store.markRunning(event.id);
    const api = this.apiFactory(config);
    let runId = event.runId ?? job.runId ?? null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      const projectKey = event.task?.projectKey;
      const taskNumber = event.task?.number;
      if (!projectKey || !taskNumber) throw new Error("Webhook task is missing project key/number for context lookup");
      const context = await api.request(`/api/context?project=${encodeURIComponent(projectKey)}&task=${encodeURIComponent(`${projectKey}-${taskNumber}`)}`) as unknown as ContextResponse;
      const task = context.task;
      if (!task?.id) throw new Error("Task context was not returned");
      // Webhooks are at-least-once and can arrive out of order. A status event
      // that no longer describes the current task must not start another run
      // or emit a handoff that could loop the workflow backwards.
      if (event.event === "task.status_changed" && event.task?.status && task.status && event.task.status !== task.status && event.previousStatus !== task.status) {
        this.store.markComplete(event.id, "SUCCEEDED");
        return;
      }
      const kind = this.kind({ ...event, task: { ...event.task, ...task } });
      if (!runId) {
        const created = await api.request(`/api/tasks/${task.id}/runs`, { method: "POST", body: JSON.stringify({ kind }) });
        runId = String((created.run as { id: string }).id);
        this.store.setRunId(event.id, runId);
      }
      await api.request(`/api/runs/${runId}/claim`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) });
      heartbeat = setInterval(() => { void api.request(`/api/runs/${runId}/heartbeat`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) }).catch(() => undefined); }, 30_000);
      heartbeat.unref?.();
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: `Smithy started ${kind.toLowerCase()} run ${runId}.` }) });
      const statuses = context.project.availableStatuses;
      const startStatus = kind === "IMPLEMENTATION" || kind === "FIX" ? "IN_PROGRESS" : kind === "RE_REVIEW" ? "RE_REVIEW" : "IN_REVIEW";
      if (statuses.includes(startStatus) && task.status !== startStatus) await api.request(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: startStatus, runId }) });
      const prompt = [`TaskForge task ${projectKey}-${taskNumber}: ${task.title ?? ""}`, task.description ?? "", `Definition of done: ${task.definitionOfDone ?? ""}`, ...(task.updates ?? []).map((update) => `Update: ${update.body}`), "Report progress through the TaskForge API. Do not merge changes yourself."].join("\n\n");
      const repo = context.project.localRepoPath || config.repo;
      if (!repo) throw new Error("Project localRepoPath is not configured and no Smithy provider fallback repo is set");
      const cwd = await this.worktree(repo, task.branch ?? event.task?.branch ?? null, task.id);
      const result = await this.execute(config.cmd, prompt, cwd);
      if (result.code !== 0) throw new Error(redact(result.error?.message ?? (result.stderr || `Provider exited with code ${result.code}`)));
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: kind === "REVIEW" || kind === "RE_REVIEW" ? "Smithy review completed; human approval is still required." : `Smithy ${kind.toLowerCase()} run completed successfully.` }) });
      const handoffStatus = kind === "REVIEW" || kind === "RE_REVIEW" ? null : "READY_FOR_REVIEW";
      if (handoffStatus && statuses.includes(handoffStatus)) await api.request(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: handoffStatus, runId }) });
      await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "SUCCEEDED" }) });
      this.store.markComplete(event.id, "SUCCEEDED");
    } catch (error) {
      this.store.markComplete(event.id, "FAILED");
      await api.request(`/api/tasks/${event.task!.id}/updates`, { method: "POST", body: JSON.stringify({ body: `Smithy run failed: ${redact(error instanceof Error ? error.message : "Runner failure")}` }) }).catch(() => undefined);
      if (runId) await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "FAILED", error: redact(error instanceof Error ? error.message : "Runner failure") }) }).catch(() => undefined);
    } finally { if (heartbeat) clearInterval(heartbeat); }
    void job;
  }
}
