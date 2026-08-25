import type { ProviderConfig, ProviderLabel } from "./config.js";
import { ApiClient } from "./api.js";
import { executeCommand } from "./command.js";
import { redact, verifySignature } from "./security.js";
import type { JobStore } from "./store.js";
import { MemoryJobStore } from "./store.js";

export interface AgentEvent { id: string; event: string; previousStatus?: string; task?: { id: string; number?: number; title?: string; description?: string; definitionOfDone?: string; projectKey?: string; branch?: string | null; status?: string }; runId?: string | null; }
export type RunnerResult = { status: number; body: string };
type AgentWorkflow = { implementationQueue: string; implementationStart: string; reviewHandoff: string; reviewStart: string; approved: string; fixNeeded: string; fixStart: string; reReview: string };
type ContextResponse = { project: { key: string; availableStatuses: string[]; localRepoPath?: string | null; agentWorkflow?: AgentWorkflow | null }; task: AgentEvent["task"] & { updates?: Array<{ body: string }> } };
type WorktreeFactory = (repo: string, branch: string | null, taskId: string) => Promise<string>;

const noopWorktree: WorktreeFactory = async (repo) => repo;

export class SmithyRunner {
  private readonly store: JobStore;
  private readonly activeByTask = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly cancelled = new Set<string>();
  constructor(
    private readonly providers: Partial<Record<ProviderLabel, ProviderConfig>>,
    private readonly apiFactory: (config: ProviderConfig) => ApiClient = (config) => new ApiClient(process.env.TASKFORGE_API_URL ?? "http://127.0.0.1:4000", config.apiToken),
    private readonly execute = executeCommand,
    private readonly now = () => Date.now(),
    store: JobStore = new MemoryJobStore(),
    private readonly worktree: WorktreeFactory = noopWorktree,
  ) { this.store = store; }

  async resume() {
    for (const job of this.store.pending()) {
      const event = JSON.parse(job.body) as AgentEvent;
      if (this.activeByTask.has(job.taskId)) continue;
      // A process that died after claiming a job leaves RUNNING in SQLite.
      // Requeue only after the local lease window, retaining the event/run id
      // so the API's conditional run claim performs the cross-process guard.
      if (job.status === "RUNNING") {
        const staleBefore = new Date(this.now() - 120_000).toISOString();
        if (!this.store.requeue(job.eventId, staleBefore)) continue;
      }
      void this.process(this.providers[job.provider as ProviderLabel], event, job);
    }
  }

  /** Cancel a local job and terminate the provider process when it is running. */
  cancel(eventId: string) {
    const controller = this.controllers.get(eventId);
    if (controller) {
      this.cancelled.add(eventId);
      controller.abort();
    }
    const cancelled = this.store.cancel(eventId);
    if (cancelled) this.cancelled.add(eventId);
    return cancelled;
  }

  async handle(provider: string, headers: Record<string, string | undefined>, body: string): Promise<RunnerResult> {
    const config = this.providers[provider as ProviderLabel];
    if (!config) return { status: 404, body: JSON.stringify({ error: "Unknown or unconfigured agent" }) };
    if (!verifySignature(config.webhookSecret, headers["x-taskforge-signature"], body, Math.floor(this.now() / 1000))) return { status: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    let event: AgentEvent;
    try { event = JSON.parse(body) as AgentEvent; } catch { return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    if (!event.id || !event.task?.id) return { status: 400, body: JSON.stringify({ error: "Event task and id are required" }) };
    const accepted = this.store.accept(event.id, provider, event.task.id, body);
    if (accepted.duplicate) {
      // A failed delivery may be replayed with the same event id. Requeue it
      // so the persisted run id is retained and a second run is not created.
      if (accepted.job.status === "FAILED") {
        if (this.store.requeue(event.id)) {
          void this.process(config, event, { ...accepted.job, status: "PENDING" }).catch(() => undefined);
          return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true, retried: true }) };
        }
        return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true, retryExhausted: true }) };
      }
      return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true }) };
    }
    const owner = this.activeByTask.get(event.task.id);
    if (owner && owner !== event.id) {
      this.store.markComplete(event.id, "CANCELLED");
      return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true, activeEventId: owner }) };
    }
    void this.process(config, event, accepted.job).catch(() => undefined);
    return { status: 202, body: JSON.stringify({ accepted: true, eventId: event.id }) };
  }

  private kind(event: AgentEvent, workflow: AgentWorkflow | null | undefined): "IMPLEMENTATION" | "REVIEW" | "RE_REVIEW" | "FIX" | null {
    const status = event.task?.status;
    if (!status && event.event === "task.assigned") return "IMPLEMENTATION";
    if (!status || !["task.assigned", "task.status_changed"].includes(event.event)) return null;
    if (!workflow && event.event === "task.assigned") return "IMPLEMENTATION";
    const configured = workflow ?? { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "IN_PROGRESS", reReview: "RE_REVIEW" };
    if (status === configured.implementationQueue) return "IMPLEMENTATION";
    if (status === configured.reviewHandoff || (status === configured.reviewStart && event.previousStatus !== configured.reviewHandoff)) return "REVIEW";
    if (status === configured.fixNeeded || (status === configured.fixStart && event.previousStatus !== configured.fixNeeded)) return "FIX";
    if (status === configured.reReview) return "RE_REVIEW";
    return null;
  }

  private statusPrompt(task: NonNullable<AgentEvent["task"]>, statuses: string[], workflow: AgentWorkflow | null | undefined, kind: Exclude<ReturnType<SmithyRunner["kind"]>, null>, contextEndpoint: string, runId: string) {
    const taskEndpoint = `/api/tasks/${task.id}`;
    const findings = `GET ${taskEndpoint}/updates and GET ${taskEndpoint}/agent-logs`;
    const transition = (status: string, purpose: string) => statuses.includes(status)
      ? `- You own the ${purpose} transition: PATCH ${taskEndpoint} with {"status":"${status}","runId":"${runId}"} only after refreshing ${contextEndpoint} and confirming that ${status} is enabled.`
      : `- ${purpose}: ${status} is not enabled. Refresh ${contextEndpoint}, choose an enabled status with the same meaning, and ask the operator if no suitable transition exists.`;
    const lines = [
      "Status ownership:",
      "- Smithy never changes the task status. The assigned agent owns every implementation, review, fix, and re-review transition.",
      `- Enabled workflow statuses: ${statuses.join(", ") || "(none returned; discover the workflow before changing status)"}. Never guess a status key or PATCH a disabled status.`,
      "- Before every transition, GET the canonical context and use its latest project.availableStatuses.",
      "- If a status PATCH returns 4xx, preserve the API error in the agent log and task update, stop that handoff, and report it. Do not silently retry with another status.",
      "- Run completion is separate from task status: Smithy records the run result, but a successful run does not authorize or perform a task transition.",
    ];
    const configured = workflow ?? { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "IN_PROGRESS", reReview: "READY_FOR_REVIEW" };
    if (kind === "IMPLEMENTATION") lines.push(transition(configured.implementationStart, "implementation start"), transition(configured.reviewHandoff, "implementation handoff for review"));
    else if (kind === "FIX") lines.push(task.branch ? `- Fix needed mode: remain on the existing branch ${task.branch}; do not create or switch branches.` : "- Fix needed mode requires a configured existing task branch; stop before editing and ask the operator to set it. Never invent a branch.", `- Read the latest review findings from ${findings}, resolve and test each finding, then request re-review.`, transition(configured.fixStart, "fix start"), transition(configured.reReview, "fix handoff for re-review"));
    else if (kind === "RE_REVIEW") lines.push(`- Re-review mode: this task was previously reviewed. Read the latest findings from ${findings}, compare the current head against each finding and the Definition of done, and report remaining issues.`, transition(configured.reReview, "re-review start"), transition(configured.approved, "clean re-review approval"), transition(configured.fixNeeded, "remaining-finding fix request"), "- Do not assume approval or merge; report findings and evidence for the human/operator decision.");
    else lines.push(transition(configured.reviewStart, "review start"), `- After review, record structured findings and evidence. If clean, PATCH the task to ${configured.approved}; if changes are required, dispose findings as ${configured.fixNeeded}. Do not implement or merge changes in review mode.`);
    return lines.join("\n");
  }

  private async process(config: ProviderConfig | undefined, event: AgentEvent, job = this.store.accept(event.id, "unknown", event.task!.id, JSON.stringify(event)).job) {
    if (!config) return;
    const taskId = event.task?.id ?? job.taskId;
    const owner = this.activeByTask.get(taskId);
    if (owner && owner !== event.id) {
      this.store.markComplete(event.id, "CANCELLED");
      return;
    }
    this.activeByTask.set(taskId, event.id);
    const controller = new AbortController();
    this.controllers.set(event.id, controller);
    if (this.cancelled.has(event.id)) {
      controller.abort();
      this.controllers.delete(event.id);
      this.activeByTask.delete(taskId);
      return;
    }
    this.store.markRunning(event.id);
    const api = this.apiFactory(config);
    let runId = event.runId ?? job.runId ?? null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let logSequence = 0;
    let logQueue = Promise.resolve();
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
      const eventTask = event.previousStatus && event.task?.status && event.previousStatus === task.status
        ? { ...task, status: event.task.status }
        : { ...event.task, ...task };
      const kind = this.kind({ ...event, task: eventTask }, context.project.agentWorkflow);
      if (!kind) {
        this.store.markComplete(event.id, "SUCCEEDED");
        return;
      }
      if (kind === "FIX" && !task.branch?.trim()) throw new Error("Fix run requires an existing task branch; configure the branch before retrying");
      if (!runId) {
        const created = await api.request(`/api/tasks/${task.id}/runs`, { method: "POST", body: JSON.stringify({ kind }) });
        runId = String((created.run as { id: string }).id);
        this.store.setRunId(event.id, runId);
      }
      await api.request(`/api/runs/${runId}/claim`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) });
      heartbeat = setInterval(() => { void api.request(`/api/runs/${runId}/heartbeat`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) }).catch(() => undefined); }, 30_000);
      heartbeat.unref?.();
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: `Smithy started ${kind.toLowerCase()} run ${runId}.` }) });
      const appendLog = (stream: "stdout" | "stderr" | "system" | "callback", category: "output" | "progress" | "tool" | "callback" | "lifecycle", content: string) => {
        const sequence = logSequence++;
        const eventId = `${event.id}:${sequence}`;
        logQueue = logQueue.then(async () => { await api.request(`/api/tasks/${task.id}/agent-logs`, { method: "POST", body: JSON.stringify({ runId, provider: job.provider, stream, category, sequence, eventId, content: redact(content).slice(0, 10_000) }) }); }).catch(() => undefined);
      };
      appendLog("system", "lifecycle", `Smithy started ${kind.toLowerCase()} run ${runId}.`);
      const statuses = context.project.availableStatuses;
      const contextEndpoint = `/api/context?project=${encodeURIComponent(projectKey)}&task=${encodeURIComponent(`${projectKey}-${taskNumber}`)}`;
      const prompt = [`TaskForge task ${projectKey}-${taskNumber}: ${task.title ?? ""}`, task.description ?? "", `Definition of done: ${task.definitionOfDone ?? ""}`, ...(task.updates ?? []).map((update) => `Human update: ${update.body}`), this.statusPrompt(task, statuses, context.project.agentWorkflow, kind, contextEndpoint, runId), "Report provider output through agent logs and keep human updates focused on decisions and handoffs. Do not merge changes yourself."].join("\n\n");
      const repo = context.project.localRepoPath || config.repo;
      if (!repo) throw new Error("Project localRepoPath is not configured and no Smithy provider fallback repo is set");
      const cwd = await this.worktree(repo, task.branch ?? event.task?.branch ?? null, task.id);
      if (this.cancelled.has(event.id)) {
        await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: "Smithy run cancelled by operator." }) }).catch(() => undefined);
        await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "CANCELLED" }) }).catch(() => undefined);
        this.store.markComplete(event.id, "CANCELLED");
        return;
      }
      const result = await this.execute(config.cmd, prompt, cwd, undefined, (stream, chunk) => {
        const text = redact(chunk.trim()).slice(0, 1_000).trim();
        if (!text) return;
        appendLog(stream, "output", text);
      }, controller.signal);
      await logQueue;
      this.controllers.delete(event.id);
      if (result.cancelled || this.cancelled.has(event.id)) {
        const message = "Smithy run cancelled by operator.";
        appendLog("system", "lifecycle", message);
        await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: message }) }).catch(() => undefined);
        await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "CANCELLED" }) }).catch(() => undefined);
        this.store.markComplete(event.id, "CANCELLED");
        await logQueue;
        return;
      }
      if (result.code !== 0) {
        const reason = result.timedOut ? "Provider command timed out" : (result.error?.message ?? (result.stderr || `Provider exited with code ${result.code}`));
        appendLog("system", "lifecycle", reason);
        throw new Error(redact(reason));
      }
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: kind === "REVIEW" || kind === "RE_REVIEW" ? "Smithy review completed; human approval is still required." : `Smithy ${kind.toLowerCase()} run completed successfully.` }) });
      await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "SUCCEEDED" }) });
      appendLog("system", "lifecycle", `Smithy ${kind.toLowerCase()} run completed successfully.`);
      await logQueue;
      this.store.markComplete(event.id, "SUCCEEDED");
    } catch (error) {
      const wasCancelled = this.cancelled.has(event.id);
      this.store.markComplete(event.id, wasCancelled ? "CANCELLED" : "FAILED");
      logQueue = logQueue.then(async () => { await api.request(`/api/tasks/${event.task!.id}/agent-logs`, { method: "POST", body: JSON.stringify({ runId, provider: job.provider, stream: "system", category: "lifecycle", sequence: logSequence++, eventId: `${event.id}:failure`, content: redact(error instanceof Error ? error.message : "Runner failure") }) }); }).catch(() => undefined);
      await logQueue;
      const message = wasCancelled ? "Smithy run cancelled by operator." : `Smithy run failed: ${redact(error instanceof Error ? error.message : "Runner failure")}`;
      await api.request(`/api/tasks/${event.task!.id}/updates`, { method: "POST", body: JSON.stringify({ body: message }) }).catch(() => undefined);
      if (runId) await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: wasCancelled ? "CANCELLED" : "FAILED", ...(wasCancelled ? {} : { error: redact(error instanceof Error ? error.message : "Runner failure") }) }) }).catch(() => undefined);
    } finally {
      this.controllers.delete(event.id);
      this.cancelled.delete(event.id);
      if (this.activeByTask.get(taskId) === event.id) this.activeByTask.delete(taskId);
      if (heartbeat) clearInterval(heartbeat);
    }
    void job;
  }
}
