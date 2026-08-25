import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { FindingDisposition, TaskFindingEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";
import type { TaskFindingService } from "./services.js";
import { AutomationEngine } from "./automation-service.js";
import { enqueueTaskStatusWebhook } from "./transition-effects.js";

export class TaskFindingApplicationService implements TaskFindingService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID, private readonly automationEngine = new AutomationEngine()) {}

  async list(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (r) => { const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId); return r.findings.listForTask(taskId); });
  }

  async create(context: RequestContext, taskId: string, input: { severity: TaskFindingEntity["severity"]; title: string; body: string; filePath?: string | null; lineNumber?: number | null; runId?: string | null }) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId);
      if (!input.title.trim() || !input.body.trim()) throw new ValidationError("Finding title and body are required");
      if (input.runId) { const run = await r.runs.findById(input.runId); if (!run || run.taskId !== taskId) throw new ValidationError("runId must reference a run for this task"); }
      const now = this.now(); const finding: TaskFindingEntity = { id: this.newId(), taskId, runId: input.runId ?? null, authorId: context.actor.userId, severity: input.severity, title: input.title.trim(), body: input.body.trim(), filePath: input.filePath?.trim() || null, lineNumber: input.lineNumber ?? null, disposition: "OPEN", dispositionById: null, dispositionReason: null, decisionOwnerId: null, dueAt: null, createdAt: now, updatedAt: now };
      const created = await r.findings.create(finding); await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.finding_created", metadata: { findingId: finding.id, severity: finding.severity } }); return created;
    });
  }

  async dispose(context: RequestContext, findingId: string, input: { disposition: FindingDisposition; reason?: string | null; decisionOwnerId?: string | null; dueAt?: string | null }) {
    return this.unitOfWork.run(async (r) => {
      const finding = await r.findings.findById(findingId); if (!finding) throw new NotFoundError("Finding"); const task = await r.tasks.findById(finding.taskId); if (!task) throw new NotFoundError("Task"); const project = await this.authorize(r, context, task.projectId);
      if (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId && context.actor.userId !== finding.authorId) throw new ForbiddenError("Only the finding author, project owner, or administrator can change a finding disposition");
      if (finding.disposition !== "OPEN" && finding.disposition !== "DEFERRED" && finding.disposition !== "ESCALATED") throw new ValidationError("Finding disposition is already terminal");
      const reason = input.reason?.trim() || null;
      if (["ACCEPTED", "FIX_NEEDED", "DEFERRED", "REJECTED", "ESCALATED"].includes(input.disposition) && !reason) throw new ValidationError("A disposition reason is required");
      if (["DEFERRED", "ESCALATED"].includes(input.disposition) && (!input.decisionOwnerId || !input.dueAt || Number.isNaN(Date.parse(input.dueAt)))) throw new ValidationError("Deferred decisions require a decision owner and due date");
      const now = this.now();
      if (input.dueAt && Date.parse(input.dueAt) <= Date.parse(now)) throw new ValidationError("Decision due date must be in the future");
      if (input.decisionOwnerId && !(await r.users.findById(input.decisionOwnerId))) throw new NotFoundError("Decision owner");
      if (input.disposition === "FIX_NEEDED" && !project.availableStatuses.includes("FIX_NEEDED") && !project.availableStatuses.includes("IN_PROGRESS")) throw new ValidationError("Project workflow must enable FIX_NEEDED or IN_PROGRESS before requesting fixes");
      if (input.disposition === "ESCALATED" && !project.availableStatuses.includes("PENDING_DECISION")) throw new ValidationError("Project workflow must enable PENDING_DECISION before escalating a finding");
      const targetStatus = input.disposition === "FIX_NEEDED" ? (project.availableStatuses.includes("FIX_NEEDED") ? "FIX_NEEDED" : "IN_PROGRESS") : input.disposition === "ESCALATED" ? "PENDING_DECISION" : null;
      if (targetStatus && task.status !== targetStatus && !({ IN_REVIEW: ["FIX_NEEDED", "IN_PROGRESS", "PENDING_DECISION"], RE_REVIEW: ["FIX_NEEDED", "IN_PROGRESS", "PENDING_DECISION"], READY_FOR_REVIEW: ["FIX_NEEDED", "IN_PROGRESS", "PENDING_DECISION"], IN_PROGRESS: ["FIX_NEEDED", "PENDING_DECISION"] } as Record<string, string[]>)[task.status]?.includes(targetStatus)) throw new ValidationError(`Task status ${task.status} cannot transition to ${targetStatus} for this decision`);
      const updated = await r.findings.dispose(findingId, input.disposition, context.actor.userId, reason, input.decisionOwnerId ?? null, input.dueAt ?? null, now); if (!updated) throw new ValidationError("Finding disposition changed before this decision was recorded");
      if (input.disposition === "FIX_NEEDED") {
        const fixStatus = project.availableStatuses.includes("FIX_NEEDED") ? "FIX_NEEDED" : project.availableStatuses.includes("IN_PROGRESS") ? "IN_PROGRESS" : null;
        if (!fixStatus) throw new ValidationError("Project workflow must enable FIX_NEEDED or IN_PROGRESS before requesting fixes");
        const gate = await r.gates.findByTask(task.id);
        if (gate) await r.gates.save({ ...gate, approvedHeadSha: null, approvedById: null, approvedAt: null, mergedHeadSha: null, mergedById: null, mergedAt: null, updatedAt: now });
        const changed = await r.tasks.update(task.id, { status: fixStatus });
        const attemptCount = await r.runs.countForTask(task.id); if (attemptCount >= 6) throw new ValidationError("Task has reached the maximum autonomous delivery cycle limit");
        const run = await r.runs.create({ id: this.newId(), taskId: task.id, projectId: task.projectId, requestedById: context.actor.userId, kind: "FIX", status: "PENDING", attemptCount: 0, maxAttempts: 3, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: null, lastError: null, createdAt: now, updatedAt: now, completedAt: null });
        const automated = await this.automationEngine.apply(r, context, task, changed, "TASK_UPDATED");
        await enqueueTaskStatusWebhook(r, automated, task.status, context, run.id, this.newId, this.now);
      } else if (input.disposition === "ESCALATED") {
        const changed = await r.tasks.update(task.id, { status: "PENDING_DECISION" });
        const automated = await this.automationEngine.apply(r, context, task, changed, "TASK_UPDATED");
        await enqueueTaskStatusWebhook(r, automated, task.status, context, null, this.newId, this.now);
      }
      await r.activity.record({ projectId: task.projectId, taskId: task.id, actorId: context.actor.userId, action: "task.finding_disposed", metadata: { findingId, disposition: input.disposition, reason, decisionOwnerId: input.decisionOwnerId ?? null, dueAt: input.dueAt ?? null } }); return updated;
    });
  }

  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
