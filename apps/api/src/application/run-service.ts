import { createHash, randomUUID } from "node:crypto";
import type { AgentRunIntervention } from "@taskforge/contracts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentRunEntity, TaskEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export class AgentRunApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID) {}

  async expire() {
    return this.unitOfWork.run((r) => r.runs.expire(this.now()));
  }

  async create(context: RequestContext, taskId: string, input: { kind: AgentRunEntity["kind"]; maxAttempts?: number; timeoutAt?: string | null }) {
    return this.unitOfWork.run(async (r) => {
      await r.runs.expire(this.now());
      const task = await r.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      await this.authorize(r, context, task.projectId);
      const cycle = await r.runs.cycleState(taskId);
      if (cycle.count >= cycle.limit) throw new ValidationError("Task has reached the maximum autonomous delivery cycle limit");
      const now = this.now();
      const assignee = task.assigneeId ? await r.users.findById(task.assigneeId) : null;
      const run: AgentRunEntity = { id: this.newId(), taskId, projectId: task.projectId, requestedById: context.actor.userId, executedById: null, kind: input.kind, status: "PENDING", controlState: "ACTIVE", controlVersion: 0, assignedAgentId: assignee?.kind === "AGENT" ? assignee.id : null, inputRequest: null, inputResponse: null, inputRequestedAt: null, inputAnsweredAt: null, takeoverById: null, attemptCount: 0, maxAttempts: Math.max(1, Math.min(10, input.maxAttempts ?? 3)), leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: input.timeoutAt ?? null, lastError: null, createdAt: now, updatedAt: now, completedAt: null };
      return r.runs.create(run);
    });
  }

  async list(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId); const [runs, cycle] = await Promise.all([r.runs.listForTask(taskId), r.runs.cycleState(taskId)]); return { runs, cycle: { count: cycle.count, limit: cycle.limit, limitFailure: cycle.limitFailure } }; });
  }

  async forceCycle(context: RequestContext, taskId: string, requestId: string) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      const project = await this.authorize(r, context, task.projectId);
      if (context.actor.kind !== "HUMAN" || (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId)) throw new ForbiddenError("Only a project owner or administrator can force an additional delivery cycle");
      const existing = await r.runs.findCycleGrant(requestId);
      let result;
      if (existing) {
        if (existing.taskId !== taskId) throw new ConflictError("Idempotency key is already used for another task");
        result = { grant: existing, created: false };
      } else {
        const cycle = await r.runs.cycleState(taskId);
        if (!cycle.limitFailure || !cycle.failureEventId) throw new ValidationError("The task does not have a current cycle-limit failure");
        result = await r.runs.grantCycle({ taskId, priorCount: cycle.count, newLimit: cycle.limit + 1, requestId, smithyEventId: cycle.failureEventId, actorId: context.actor.userId, createdAt: this.now() });
      }
      const assignee = task.assigneeId ? await r.users.findById(task.assigneeId) : null;
      if (!assignee || assignee.kind !== "AGENT") throw new ValidationError("The task must be assigned to a configured agent before forcing a cycle");
      const webhook = await r.users.getWebhookConfiguration(assignee.id);
      if (!webhook?.webhookUrl || !webhook.secretCiphertext) throw new ValidationError("The assigned agent does not have a configured Smithy webhook");
      if (result.created) await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.agent_cycle_forced", metadata: { priorCount: result.grant.priorCount, newLimit: result.grant.newLimit } });
      return { grant: result.grant, duplicate: !result.created, agentId: assignee.id, webhook };
    });
  }

  async claim(context: RequestContext, runId: string, leaseMs = 60_000) {
    return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); if (context.actor.kind !== "AGENT") throw new ForbiddenError("Only agents can claim agent runs"); if (run.controlState !== "ACTIVE") throw new ValidationError("Agent run is paused or waiting for operator input"); if (run.assignedAgentId && run.assignedAgentId !== context.actor.userId) throw new ForbiddenError("Agent run is assigned to another agent"); if (run.attemptCount >= run.maxAttempts) throw new ValidationError("Agent run has exhausted its retry budget"); const now = this.now(); const claimed = await r.runs.claim(runId, context.actor.userId, now, new Date(Date.parse(now) + Math.max(5_000, Math.min(15 * 60_000, leaseMs))).toISOString()); if (!claimed) throw new ValidationError("Agent run is already leased or no longer runnable"); return r.runs.findById(runId); });
  }

  async heartbeat(context: RequestContext, runId: string, controlVersion: number, leaseMs = 60_000) { return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); const now = this.now(); const ok = await r.runs.heartbeat(runId, context.actor.userId, controlVersion, now, new Date(Date.parse(now) + Math.max(5_000, Math.min(15 * 60_000, leaseMs))).toISOString()); if (!ok) { const current = await r.runs.findById(runId); if (current && (current.controlVersion !== controlVersion || current.controlState !== "ACTIVE")) throw new ConflictError("Agent run control decision superseded this worker"); throw new ValidationError("Agent run lease is stale"); } return r.runs.findById(runId); }); }

  async complete(context: RequestContext, runId: string, controlVersion: number, status: "SUCCEEDED" | "FAILED", error?: string | null) { return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); const now = this.now(); if (!(await r.runs.complete(runId, context.actor.userId, controlVersion, status, now, error ?? null))) { const current = await r.runs.findById(runId); if (current && (current.controlVersion !== controlVersion || current.controlState !== "ACTIVE")) throw new ConflictError("Agent run control decision superseded this worker"); throw new ValidationError("Agent run lease is stale"); } await r.tokens.revokeRunCredential(runId, now); return r.runs.findById(runId); }); }

  async intervene(context: RequestContext, runId: string, requestId: string, input: AgentRunIntervention) {
    return this.unitOfWork.run(async (r) => {
      const run = await r.runs.findById(runId);
      if (!run) throw new NotFoundError("Agent run");
      const project = await this.authorize(r, context, run.projectId);
      const payloadHash = createHash("sha256").update(JSON.stringify({ runId, ...input })).digest("hex");
      const existing = await r.runs.findIntervention(requestId);
      if (existing) {
        if (existing.runId !== runId || existing.action !== input.action || existing.payloadHash !== payloadHash) throw new ConflictError("Idempotency key is already used for another intervention");
        if (existing.actorId !== context.actor.userId) throw new ConflictError("Idempotency key is already used by another actor");
        return { run, duplicate: true };
      }

      const isRequest = input.action === "REQUEST_INPUT";
      if (isRequest) {
        if (context.actor.kind !== "AGENT" || run.leaseOwner !== context.actor.userId || run.status !== "RUNNING" || run.controlState !== "ACTIVE") throw new ForbiddenError("Only the current lease owner can request operator input");
      } else if (context.actor.kind !== "HUMAN" || (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId)) {
        throw new ForbiddenError("Only a project owner or administrator can control an agent run");
      }
      if (run.controlVersion !== input.controlVersion) throw new ConflictError("Agent run changed; refresh it before applying this intervention");

      const now = this.now();
      const update: Parameters<typeof r.runs.applyIntervention>[2] = {};
      let dispatchAgentId: string | null = null;
      if (input.action === "PAUSE") {
        if (run.controlState !== "ACTIVE" || !["PENDING", "RUNNING"].includes(run.status)) throw new ValidationError("Only an active run can be paused");
        Object.assign(update, { controlState: "PAUSED" });
      } else if (input.action === "RESUME") {
        if (run.controlState !== "PAUSED") throw new ValidationError("Only a paused run can be resumed");
        dispatchAgentId = await this.requireAgent(r, run.assignedAgentId ?? run.executedById, run.projectId);
        Object.assign(update, { status: "PENDING", controlState: "ACTIVE", completedAt: null, lastError: null });
      } else if (input.action === "CANCEL") {
        if (["SUCCEEDED", "CANCELLED"].includes(run.status)) throw new ValidationError("Agent run is already terminal");
        Object.assign(update, { status: "CANCELLED", controlState: "ACTIVE", completedAt: now, lastError: "Cancelled by operator" });
      } else if (input.action === "RETRY") {
        if (run.status !== "FAILED") throw new ValidationError("Only a failed run can be retried");
        if (run.attemptCount >= run.maxAttempts) throw new ValidationError("Agent run has exhausted its retry budget");
        dispatchAgentId = await this.requireAgent(r, run.assignedAgentId ?? run.executedById, run.projectId);
        Object.assign(update, { status: "PENDING", controlState: "ACTIVE", completedAt: null, lastError: null });
      } else if (input.action === "REASSIGN") {
        if (["SUCCEEDED", "CANCELLED"].includes(run.status)) throw new ValidationError("A terminal run cannot be reassigned");
        dispatchAgentId = await this.requireAgent(r, input.agentId ?? null, run.projectId);
        Object.assign(update, { status: "PENDING", controlState: "ACTIVE", assignedAgentId: dispatchAgentId, completedAt: null, lastError: null });
      } else if (input.action === "REQUEST_INPUT") {
        Object.assign(update, { controlState: "WAITING_FOR_INPUT", inputRequest: redact(input.input!), inputResponse: null, inputRequestedAt: now, inputAnsweredAt: null });
      } else if (input.action === "ANSWER") {
        if (run.controlState !== "WAITING_FOR_INPUT") throw new ValidationError("This run is not waiting for input");
        dispatchAgentId = await this.requireAgent(r, run.assignedAgentId ?? run.executedById, run.projectId);
        Object.assign(update, { status: "PENDING", controlState: "ACTIVE", inputResponse: redact(input.input!), inputAnsweredAt: now, completedAt: null, lastError: null });
      } else if (input.action === "TAKEOVER") {
        if (["SUCCEEDED", "CANCELLED"].includes(run.status)) throw new ValidationError("Agent run is already terminal");
        Object.assign(update, { status: "CANCELLED", controlState: "HUMAN_TAKEOVER", takeoverById: context.actor.userId, completedAt: now, lastError: "Human takeover" });
      }

      if (!(await r.runs.applyIntervention(runId, input.controlVersion, update, now))) throw new ConflictError("Agent run changed; refresh it before applying this intervention");
      const resultVersion = input.controlVersion + 1;
      await r.runs.recordIntervention({ requestId, runId, actorId: context.actor.userId, action: input.action, payloadHash, resultVersion, createdAt: now });
      await r.tokens.revokeRunCredential(runId, now);
      const task = await r.tasks.findById(run.taskId);
      if (!task) throw new NotFoundError("Task");
      if (input.action === "REASSIGN" && dispatchAgentId) await r.tasks.update(task.id, { assigneeId: dispatchAgentId, updatedAt: now });
      if (input.action === "TAKEOVER") await r.tasks.update(task.id, { assigneeId: context.actor.userId, updatedAt: now });
      await r.activity.record({ projectId: run.projectId, taskId: run.taskId, actorId: context.actor.userId, action: "agent_run.intervention", metadata: { runId, intervention: input.action, controlVersion: resultVersion, targetAgentId: dispatchAgentId } });
      if (dispatchAgentId) await this.enqueueRun(r, task, project.key, run, dispatchAgentId, input.action, input.action === "ANSWER" ? redact(input.input!) : null, now);
      return { run: await r.runs.findById(runId), duplicate: false };
    });
  }

  private async requireAgent(r: RepositorySet, agentId: string | null, projectId: string) {
    if (!agentId) throw new ValidationError("Choose a configured agent before continuing the run");
    const agent = await r.users.findById(agentId);
    if (!agent || agent.kind !== "AGENT" || !(await r.memberships.isMember(projectId, agentId))) throw new ValidationError("The selected agent is not a member of this project");
    const webhook = await r.users.getWebhookConfiguration(agentId);
    if (!webhook?.webhookUrl || !webhook.secretCiphertext) throw new ValidationError("The selected agent does not have a configured Smithy webhook");
    return agentId;
  }

  private async enqueueRun(r: RepositorySet, task: TaskEntity, projectKey: string, run: AgentRunEntity, agentId: string, action: AgentRunIntervention["action"], operatorInput: string | null, now: string) {
    const id = this.newId();
    const payload = { id, event: "task.assigned", runId: run.id, runKind: run.kind, interventionAction: action, operatorInput, task: { id: task.id, number: task.number, title: task.title, description: task.description, definitionOfDone: task.definitionOfDone, status: task.status, priority: task.priority, type: task.type, branch: task.branch, projectId: task.projectId, projectKey, assigneeId: agentId }, assignedBy: { id: "operator", name: "TaskForge intervention" }, timestamp: now };
    await r.webhookDeliveries.create({ id, agentId, taskId: task.id, eventType: "task.assigned", payload: JSON.stringify(payload), status: "PENDING", attemptCount: 0, nextAttemptAt: now, lockedUntil: null, lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null, createdAt: now, updatedAt: now });
  }

  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}

function redact(value: string) {
  return value.replace(/(authorization\s*:\s*bearer\s+|\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED]").replace(/\btfr?_[A-Za-z0-9_-]+\b/g, "tf_[REDACTED]").replace(/\b(?:sk|whsec)_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}
