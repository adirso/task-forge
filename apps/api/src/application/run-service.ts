import { randomUUID } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentRunEntity } from "./models.js";
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
      const run: AgentRunEntity = { id: this.newId(), taskId, projectId: task.projectId, requestedById: context.actor.userId, kind: input.kind, status: "PENDING", attemptCount: 0, maxAttempts: Math.max(1, Math.min(10, input.maxAttempts ?? 3)), leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: input.timeoutAt ?? null, lastError: null, createdAt: now, updatedAt: now, completedAt: null };
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
    return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); if (run.attemptCount >= run.maxAttempts) throw new ValidationError("Agent run has exhausted its retry budget"); const now = this.now(); const claimed = await r.runs.claim(runId, context.actor.userId, now, new Date(Date.parse(now) + Math.max(5_000, Math.min(15 * 60_000, leaseMs))).toISOString()); if (!claimed) throw new ValidationError("Agent run is already leased or no longer runnable"); return r.runs.findById(runId); });
  }

  async heartbeat(context: RequestContext, runId: string, leaseMs = 60_000) { return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); const now = this.now(); const ok = await r.runs.heartbeat(runId, context.actor.userId, now, new Date(Date.parse(now) + Math.max(5_000, Math.min(15 * 60_000, leaseMs))).toISOString()); if (!ok) throw new ValidationError("Agent run lease is not owned by this actor"); return r.runs.findById(runId); }); }

  async complete(context: RequestContext, runId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED", error?: string | null) { return this.unitOfWork.run(async (r) => { await r.runs.expire(this.now()); const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); const project = await this.authorize(r, context, run.projectId); const now = this.now(); if (status === "CANCELLED") { if (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId) throw new ForbiddenError("Only a project owner or administrator can cancel an agent run"); if (!(await r.runs.cancel(runId, now, error ?? "Cancelled by operator"))) throw new ValidationError("Agent run is already terminal"); return r.runs.findById(runId); } if (!(await r.runs.complete(runId, context.actor.userId, status, now, error ?? null))) throw new ValidationError("Agent run lease is not owned by this actor"); return r.runs.findById(runId); }); }

  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
