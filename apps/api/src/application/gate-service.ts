import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { TaskGateEntity } from "./models.js";
import type { UnitOfWork } from "./repositories.js";
import type { TaskGateService } from "./services.js";

const sha = (value: string) => /^[0-9a-f]{7,64}$/i.test(value);

export class TaskGateApplicationService implements TaskGateService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString()) {}

  async get(context: RequestContext, taskId: string) { return this.unitOfWork.run(async (r) => { const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId); return r.gates.findByTask(taskId); }); }

  async record(context: RequestContext, taskId: string, input: Pick<TaskGateEntity, "headSha" | "requiredChecks" | "checks">) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId);
      this.validateEvidence(input);
      const existing = await r.gates.findByTask(taskId); const changedHead = existing && existing.headSha !== input.headSha;
      const gate: TaskGateEntity = { taskId, headSha: input.headSha, requiredChecks: [...new Set(input.requiredChecks)], checks: input.checks, approvedHeadSha: changedHead ? null : existing?.approvedHeadSha ?? null, approvedById: changedHead ? null : existing?.approvedById ?? null, approvedAt: changedHead ? null : existing?.approvedAt ?? null, mergedHeadSha: changedHead ? null : existing?.mergedHeadSha ?? null, mergedById: changedHead ? null : existing?.mergedById ?? null, mergedAt: changedHead ? null : existing?.mergedAt ?? null, updatedAt: this.now() };
      return r.gates.save(gate);
    });
  }

  async approve(context: RequestContext, taskId: string, headSha: string) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId);
      if (context.actor.kind !== "AGENT" || !(context.actor.name ?? "").toLowerCase().includes("codex")) throw new ForbiddenError("Only the Codex review agent can approve a task gate");
      const gate = await this.requireReady(r, taskId, headSha); const approved = await r.gates.approve(taskId, headSha, context.actor.userId, this.now()); if (!approved) throw new ValidationError("The PR head changed before approval");
      await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.gate_approved", metadata: { headSha, requiredChecks: gate.requiredChecks } }); return approved;
    });
  }

  async merge(context: RequestContext, taskId: string, headSha: string) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); const project = await this.authorize(r, context, task.projectId);
      if (context.actor.kind !== "HUMAN" || (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId)) throw new ForbiddenError("Only a project owner or administrator can authorize a merge");
      await this.requireReady(r, taskId, headSha); const gate = await r.gates.findByTask(taskId); if (!gate?.approvedHeadSha || gate.approvedHeadSha !== headSha) throw new ValidationError("A Codex approval for the current PR head is required before merging");
      const merged = await r.gates.merge(taskId, headSha, context.actor.userId, this.now()); if (!merged) throw new ValidationError("The PR head changed before merge authorization");
      await r.tasks.update(taskId, { pullRequestState: "MERGED" }); await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.merge_authorized", metadata: { headSha, approvedById: gate.approvedById } }); return merged;
    });
  }

  private async requireReady(r: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], taskId: string, headSha: string) {
    if (!sha(headSha)) throw new ValidationError("headSha must be a commit SHA"); const gate = await r.gates.findByTask(taskId); if (!gate || gate.headSha !== headSha) throw new ValidationError("Gate evidence is missing for the current PR head");
    const required = new Set(gate.requiredChecks); const passed = new Set(gate.checks.filter((check) => check.headSha === headSha && check.status === "PASS").map((check) => check.name)); const missing = [...required].filter((check) => !passed.has(check)); if (missing.length) throw new ValidationError(`Required CI checks are not passing for this PR head: ${missing.join(", ")}`); return gate;
  }
  private validateEvidence(input: Pick<TaskGateEntity, "headSha" | "requiredChecks" | "checks">) { if (!sha(input.headSha)) throw new ValidationError("headSha must be a commit SHA"); if (new Set(input.requiredChecks).size !== input.requiredChecks.length) throw new ValidationError("Required CI checks must be unique"); if (input.checks.some((check) => !sha(check.headSha) || !check.name || !["PASS", "FAIL", "PENDING"].includes(check.status))) throw new ValidationError("Invalid CI check evidence"); }
  private async authorize(r: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
