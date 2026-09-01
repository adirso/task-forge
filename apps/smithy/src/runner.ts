import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderConfig, ProviderLabel } from "./config.js";
import { ApiClient } from "./api.js";
import { executeCommand } from "./command.js";
import { redact, verifySignature } from "./security.js";
import type { JobStore } from "./store.js";
import { MemoryJobStore } from "./store.js";

export interface AgentEvent { id: string; event: string; previousStatus?: string; task?: { id: string; number?: number; title?: string; description?: string; definitionOfDone?: string; projectKey?: string; branch?: string | null; status?: string; pullRequestUrl?: string | null; pullRequestTitle?: string | null; pullRequestState?: "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | null }; runId?: string | null; }
export type RunnerResult = { status: number; body: string };
type AgentWorkflow = { implementationQueue: string; implementationStart: string; reviewHandoff: string; reviewStart: string; approved: string; fixNeeded: string; fixStart: string; reReview: string };
type TaskFinding = { severity?: string; title?: string; body?: string; disposition?: string; filePath?: string | null; lineNumber?: number | null };
type VerifiedHandoff = { branch?: string | null; headSha?: string | null; branchPublished?: boolean; pullRequestUrl?: string | null; pullRequestState?: string | null; status?: string };
type ContextResponse = { project: { key: string; availableStatuses: string[]; localRepoPath?: string | null; agentWorkflow?: AgentWorkflow | null }; task: AgentEvent["task"] & { updates?: Array<{ body: string }>; findings?: TaskFinding[] } };
type WorktreeFactory = (repo: string, branch: string | null, taskId: string) => Promise<string>;

// Legacy projects have no persisted mapping. Keep their historical routing
// semantics without treating the ordinary IN_PROGRESS status as a fix run.
const LEGACY_AGENT_WORKFLOW: AgentWorkflow = {
  implementationQueue: "TODO",
  implementationStart: "IN_PROGRESS",
  reviewHandoff: "READY_FOR_REVIEW",
  reviewStart: "IN_REVIEW",
  approved: "APPROVED",
  fixNeeded: "FIX_NEEDED",
  fixStart: "FIX_IN_PROGRESS",
  reReview: "RE_REVIEW",
};

const noopWorktree: WorktreeFactory = async (repo) => repo;
const readGit = promisify(execFile);

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
    private readonly heartbeatIntervalMs = 30_000,
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

  async forceCycle(provider: string, headers: Record<string, string | undefined>, body: string): Promise<RunnerResult> {
    const config = this.providers[provider as ProviderLabel];
    if (!config) return { status: 404, body: JSON.stringify({ error: "Unknown or unconfigured agent" }) };
    if (!verifySignature(config.webhookSecret, headers["x-taskforge-signature"], body, Math.floor(this.now() / 1000))) return { status: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    let input: { id?: unknown; taskId?: unknown; eventId?: unknown };
    try { input = JSON.parse(body) as typeof input; } catch { return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    if (typeof input.id !== "string" || !input.id.trim() || typeof input.taskId !== "string" || !input.taskId.trim() || typeof input.eventId !== "string" || !input.eventId.trim()) return { status: 400, body: JSON.stringify({ error: "Force request id, taskId, and eventId are required" }) };
    const result = this.store.force(input.id, provider, input.taskId, input.eventId);
    if (result.status === "not_found") return { status: 404, body: JSON.stringify({ error: "Failed cycle event was not found" }) };
    if (result.status === "not_failed") return { status: 409, body: JSON.stringify({ error: "Cycle event is not failed" }) };
    const forcedJob = result.job;
    if (result.status === "accepted") {
      const event = JSON.parse(forcedJob.body) as AgentEvent;
      void this.process(config, event, forcedJob).catch(() => undefined);
    }
    return { status: 202, body: JSON.stringify({ accepted: true, duplicate: result.status === "duplicate", eventId: forcedJob.eventId }) };
  }

  private kind(event: AgentEvent, workflow: AgentWorkflow | null | undefined): "IMPLEMENTATION" | "REVIEW" | "RE_REVIEW" | "FIX" | null {
    const status = event.task?.status;
    if (!status && event.event === "task.assigned") return "IMPLEMENTATION";
    if (!status || !["task.assigned", "task.status_changed"].includes(event.event)) return null;
    if (!workflow && event.event === "task.assigned") return "IMPLEMENTATION";
    const configured = workflow ?? LEGACY_AGENT_WORKFLOW;
    if (status === configured.implementationQueue) return "IMPLEMENTATION";
    if (status === configured.reviewHandoff || (status === configured.reviewStart && event.previousStatus !== configured.reviewHandoff)) return "REVIEW";
    if (status === configured.fixNeeded || (status === configured.fixStart && event.previousStatus !== configured.fixNeeded)) return "FIX";
    if (status === configured.reReview) return "RE_REVIEW";
    return null;
  }

  private resolveWorkflow(workflow: AgentWorkflow | null | undefined, statuses: string[]) {
    if (!workflow) return LEGACY_AGENT_WORKFLOW;
    const keys = Object.keys(LEGACY_AGENT_WORKFLOW) as Array<keyof AgentWorkflow>;
    const missing = keys.filter((key) => typeof workflow[key] !== "string" || !workflow[key].trim());
    const disabled = keys.filter((key) => typeof workflow[key] === "string" && !statuses.includes(workflow[key]));
    if (missing.length || disabled.length) {
      const details = [missing.length ? `missing ${missing.join(", ")}` : "", disabled.length ? `disabled ${disabled.map((key) => `${key}=${workflow[key]}`).join(", ")}` : ""].filter(Boolean).join("; ");
      throw new Error(`Invalid project agent workflow mapping: ${details}. Enable every mapped status before assigning an agent.`);
    }
    return workflow;
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
    const configured = workflow ?? LEGACY_AGENT_WORKFLOW;
    if (kind === "IMPLEMENTATION") lines.push(transition(configured.implementationStart, "implementation start"), "- First make the implementation-start status transition, then edit and test the task.", "- Before requesting review, commit all changes, push the existing task branch, and create or update the pull request with the git/GitHub credentials available to you. Capture the exact pushed commit SHA and PR URL/title/state; never claim publication from a local branch alone.", `- Persist verified handoff evidence with PUT /api/runs/${runId}/handoff: include branch, pushed commit headSha, branchPublished=true, and pull-request URL/title/state. Retry idempotently if the callback fails; do not request review until it is accepted.`, `- If git, GitHub CLI, credentials, push, or PR creation fails, redact the diagnostic, record it in the agent log and task update, and leave the task in progress for recovery.`, transition(configured.reviewHandoff, "implementation handoff for review"));
    else if (kind === "FIX") lines.push(task.branch ? `- Fix needed mode: remain on the existing branch ${task.branch}; do not create or switch branches.` : "- Fix needed mode requires a configured existing task branch; stop before editing and ask the operator to set it. Never invent a branch.", `- Read the latest review findings from ${findings}, resolve and test each finding, then commit the fixes, push this same branch, and create or update the existing pull request. Capture the exact new head SHA and PR metadata.`, `- Persist the verified fix handoff with PUT /api/runs/${runId}/handoff using branchPublished=true, the pushed headSha, and pull-request URL/title/state; retry idempotently and request re-review only after it is accepted.`, "- If git/GitHub credentials, push, or PR publication fails, redact and record the actionable error and leave the task in fix progress for recovery.", transition(configured.fixStart, "fix start"), transition(configured.reReview, "fix handoff for re-review"));
    else if (kind === "RE_REVIEW") lines.push(`- Re-review mode: this task was previously reviewed. Read the latest findings from ${findings}, compare the current head against each finding and the Definition of done, and report remaining issues.`, `- Verify the task's canonical branch, pushed head SHA, and pull-request URL/state before reviewing; report missing or inconsistent publication evidence instead of assuming it is valid.`, transition(configured.reReview, "re-review start"), transition(configured.approved, "clean re-review approval"), transition(configured.fixNeeded, "remaining-finding fix request"), "- Do not assume approval or merge; report findings and evidence for the human/operator decision.");
    else lines.push(transition(configured.reviewStart, "review start"), `- Verify the task's canonical branch, pushed head SHA, and pull-request URL/state before reviewing; report missing or inconsistent publication evidence instead of assuming it is valid.`, `- After review, record structured findings and evidence. If clean, PATCH the task to ${configured.approved}; if changes are required, dispose findings as ${configured.fixNeeded}. Do not implement or merge changes in review mode.`);
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
    let leaseLost = false;
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
      // Determine whether this event is actionable before validating an opt-in
      // mapping. Inert updates/statuses must remain harmless no-ops.
      const kind = this.kind({ ...event, task: eventTask }, context.project.agentWorkflow);
      if (!kind) {
        this.store.markComplete(event.id, "SUCCEEDED");
        return;
      }
      const workflow = this.resolveWorkflow(context.project.agentWorkflow, context.project.availableStatuses);
      if (kind === "FIX" && !task.branch?.trim()) throw new Error("Fix run requires an existing task branch; configure the branch before retrying");
      if (!runId) {
        const created = await api.request(`/api/tasks/${task.id}/runs`, { method: "POST", body: JSON.stringify({ kind }) });
        runId = String((created.run as { id: string }).id);
        this.store.setRunId(event.id, runId);
      }
      await api.request(`/api/runs/${runId}/claim`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) });
      let verifiedHandoff: VerifiedHandoff | null = null;
      if (kind === "REVIEW" || kind === "RE_REVIEW") {
        try {
          const response = await api.request(`/api/runs/${runId}/handoff`) as unknown as { handoff?: VerifiedHandoff | null } & VerifiedHandoff;
          verifiedHandoff = response.handoff ?? response;
          if (verifiedHandoff?.status !== "PUBLISHED" || !verifiedHandoff.branchPublished || !verifiedHandoff.headSha) {
            const runsResponse = await api.request(`/api/tasks/${task.id}/runs`) as unknown as { runs?: Array<{ id: string }> };
            for (const candidate of runsResponse.runs ?? []) {
              if (candidate.id === runId) continue;
              try {
                const candidateResponse = await api.request(`/api/runs/${candidate.id}/handoff`) as unknown as { handoff?: VerifiedHandoff | null } & VerifiedHandoff;
                const candidateHandoff: VerifiedHandoff = candidateResponse.handoff ?? candidateResponse;
                if (candidateHandoff.status === "PUBLISHED" && candidateHandoff.branchPublished && candidateHandoff.headSha) { verifiedHandoff = candidateHandoff; break; }
              } catch { /* stale or inaccessible historical run */ }
            }
          }
        } catch { verifiedHandoff = null; }
      }
      heartbeat = setInterval(() => { void api.request(`/api/runs/${runId}/heartbeat`, { method: "POST", body: JSON.stringify({ leaseMs: 120_000 }) }).catch((error) => { if (error instanceof Error && /lease is not owned|already leased|no longer runnable/i.test(error.message)) { leaseLost = true; controller.abort(); } }); }, this.heartbeatIntervalMs);
      heartbeat.unref?.();
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: `Smithy started ${kind.toLowerCase()} run ${runId}.` }) });
      const appendLog = (stream: "stdout" | "stderr" | "system" | "callback", category: "output" | "progress" | "tool" | "callback" | "lifecycle", content: string) => {
        const sequence = logSequence++;
        const eventId = `${event.id}:${job.attemptCount + 1}:${sequence}`;
        logQueue = logQueue.then(async () => { await api.request(`/api/tasks/${task.id}/agent-logs`, { method: "POST", body: JSON.stringify({ runId, provider: job.provider, stream, category, sequence, eventId, content: redact(content).slice(0, 10_000) }) }); }).catch(() => undefined);
      };
      appendLog("system", "lifecycle", `Smithy started ${kind.toLowerCase()} run ${runId}.`);
      const statuses = context.project.availableStatuses;
      const findingResponse = await api.request(`/api/tasks/${task.id}/findings`) as unknown as { findings?: TaskFinding[] };
      const findings = Array.isArray(findingResponse.findings) ? findingResponse.findings : [];
      const contextEndpoint = `/api/context?project=${encodeURIComponent(projectKey)}&task=${encodeURIComponent(`${projectKey}-${taskNumber}`)}`;
      const findingLines = findings.map((finding) => `Finding [${finding.severity ?? "UNKNOWN"}] ${finding.disposition ? `(${finding.disposition}) ` : ""}${redact(finding.title ?? "")}: ${redact(finding.body ?? "")}${finding.filePath ? ` (${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ""})` : ""}`);
      const prTask = task as typeof task & { pullRequestUrl?: string | null; pullRequestTitle?: string | null; pullRequestState?: "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | null; headSha?: string | null; branchPublished?: boolean; status?: string };
      const publication = verifiedHandoff ?? prTask;
      const publicationState = publication.status === "PUBLISHED" && publication.branchPublished && publication.branch && publication.headSha && publication.pullRequestUrl ? "verified" : "incomplete or unverified";
      const prompt = [`TaskForge task ${projectKey}-${taskNumber}: ${redact(task.title ?? "")}`, `Branch: ${task.branch?.trim() || "(no branch configured)"}`, `Canonical publication (${publicationState}): branch ${redact(publication.branch ?? task.branch ?? "(not recorded)")}; head SHA ${redact(publication.headSha ?? "(not recorded)")}; pull request ${redact(publication.pullRequestUrl ?? prTask.pullRequestUrl ?? "(not recorded)")} (${redact(publication.pullRequestState ?? prTask.pullRequestState ?? "unknown")})`, redact(task.description ?? ""), `Definition of done: ${redact(task.definitionOfDone ?? "")}`, ...(task.updates ?? []).map((update) => `Human update: ${redact(update.body)}`), ...(findingLines.length ? ["Review findings:", ...findingLines] : []), this.statusPrompt(task, statuses, workflow, kind, contextEndpoint, runId), "Report provider output through agent logs and keep human updates focused on decisions and handoffs. Do not merge changes yourself."].join("\n\n");
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
      if (leaseLost) throw new Error("Run lease was lost; provider execution was stopped and recovery will resume the existing run");
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
        const rawReason = result.timedOut ? "Provider command timed out" : (result.error?.message ?? (result.stderr || `Provider exited with code ${result.code}`));
        const reason = /(git|github|gh\b|credential|authentication|permission denied|could not read username|push|pull request)/i.test(rawReason) ? `Provider publication or authentication failed: ${rawReason}` : rawReason;
        appendLog("system", "lifecycle", reason);
        throw new Error(redact(reason));
      }
      // Persist a durable checkpoint even when the provider forgot to call the API.
      // PR fields are sourced from the canonical task context and never guessed.
      let headSha: string | null = null;
      try { headSha = (await readGit("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim() || null; } catch { /* provider may use a non-git checkout */ }
      // A local branch is not proof that it was pushed. Only an explicit
      // provider callback may mark branchPublished/PUBLISHED.
      const existingHandoff = await api.request(`/api/runs/${runId}/handoff`).catch(() => ({})) as { handoff?: { status?: string } };
      if (existingHandoff.handoff?.status !== "PUBLISHED") await api.request(`/api/runs/${runId}/handoff`, { method: "PUT", body: JSON.stringify({ branch: task.branch ?? null, headSha, branchPublished: false, pullRequestUrl: prTask.pullRequestUrl ?? null, pullRequestTitle: prTask.pullRequestTitle ?? null, pullRequestState: prTask.pullRequestState ?? null, status: "PENDING", lastError: "Provider completed without explicit branch publication evidence" }) });
      await api.request(`/api/tasks/${task.id}/updates`, { method: "POST", body: JSON.stringify({ body: kind === "REVIEW" || kind === "RE_REVIEW" ? "Smithy review completed; human approval is still required." : `Smithy ${kind.toLowerCase()} run completed successfully.` }) });
      await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "SUCCEEDED" }) });
      appendLog("system", "lifecycle", `Smithy ${kind.toLowerCase()} run completed successfully.`);
      await logQueue;
      this.store.markComplete(event.id, "SUCCEEDED");
    } catch (error) {
      const wasCancelled = this.cancelled.has(event.id);
      if (leaseLost) {
        this.store.requeue(event.id);
        logQueue = logQueue.then(async () => { await api.request(`/api/tasks/${event.task!.id}/agent-logs`, { method: "POST", body: JSON.stringify({ runId, provider: job.provider, stream: "system", category: "lifecycle", sequence: logSequence++, eventId: `${event.id}:${job.attemptCount + 1}:lease-lost`, content: "Run lease was lost; queued the existing run for recovery." }) }); }).catch(() => undefined);
        await logQueue;
        setTimeout(() => { void this.resume(); }, 0).unref?.();
        return;
      }
      this.store.markComplete(event.id, wasCancelled ? "CANCELLED" : "FAILED");
      logQueue = logQueue.then(async () => { await api.request(`/api/tasks/${event.task!.id}/agent-logs`, { method: "POST", body: JSON.stringify({ runId, provider: job.provider, stream: "system", category: "lifecycle", sequence: logSequence++, eventId: `${event.id}:${job.attemptCount + 1}:failure`, content: redact(error instanceof Error ? error.message : "Runner failure") }) }); }).catch(() => undefined);
      await logQueue;
      const message = wasCancelled ? "Smithy run cancelled by operator." : `Smithy run failed: ${redact(error instanceof Error ? error.message : "Runner failure")}`;
      await api.request(`/api/tasks/${event.task!.id}/updates`, { method: "POST", body: JSON.stringify({ body: message }) }).catch(() => undefined);
      if (runId) await api.request(`/api/runs/${runId}/handoff`, { method: "PUT", body: JSON.stringify({ branch: event.task?.branch ?? null, headSha: null, branchPublished: false, pullRequestUrl: event.task?.pullRequestUrl ?? null, pullRequestTitle: event.task?.pullRequestTitle ?? null, pullRequestState: event.task?.pullRequestState ?? null, status: "FAILED", lastError: redact(error instanceof Error ? error.message : "Runner failure") }) }).catch(() => undefined);
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
