import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { TaskGateEntity } from "./models.js";
import type { AgentArtifactType } from "@taskforge/contracts";
import type { UnitOfWork } from "./repositories.js";
import type { TaskGateService } from "./services.js";
import { enqueueTaskStatusWebhook } from "./transition-effects.js";

const sha = (value: string) => /^[0-9a-f]{7,64}$/i.test(value);

export class TaskGateApplicationService implements TaskGateService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString()) {}

  async get(context: RequestContext, taskId: string) { return this.unitOfWork.run(async (r) => { const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(r, context, task.projectId); return r.gates.findByTask(taskId); }); }

  async record(context: RequestContext, taskId: string, input: Pick<TaskGateEntity, "headSha" | "requiredChecks" | "checks"> & { requiredArtifactTypes?: AgentArtifactType[] }) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); const project = await this.authorize(r, context, task.projectId);
      if (!(context.actor.role === "ADMIN" || context.actor.userId === project.ownerId || (context.actor.kind === "AGENT" && context.actor.tokenScopes?.includes("task:gate:evidence")))) throw new ForbiddenError("Only the project owner, administrator, or authorized CI agent can record gate evidence");
      this.validateEvidence(input);
      const existing = await r.gates.findByTask(taskId); const changedHead = existing && existing.headSha !== input.headSha;
      const handoff = await r.handoffs.findPublishedByTaskHead(taskId, input.headSha);
      const implementationRun = handoff ? await r.runs.findById(handoff.runId) : null;
      const implementationActor = implementationRun?.executedById ? await r.users.findById(implementationRun.executedById) : null;
      const implementationAgentId = implementationActor?.kind === "AGENT" ? implementationActor.id : null;
      if (project.reviewPolicy.requireIndependentReview && (!handoff || !implementationAgentId)) throw new ValidationError("Independent review requires a published implementation handoff for this PR head");
      const requiredArtifactTypes = input.requiredArtifactTypes ?? (changedHead ? [] : existing?.requiredArtifactTypes ?? []);
      const gate: TaskGateEntity = { taskId, headSha: input.headSha, requiredChecks: [...new Set(input.requiredChecks)], requiredArtifactTypes: [...new Set(requiredArtifactTypes)], checks: input.checks, implementationRunId: handoff?.runId ?? (changedHead ? null : existing?.implementationRunId ?? null), implementationAgentId: implementationAgentId ?? (changedHead ? null : existing?.implementationAgentId ?? null), approvals: changedHead ? [] : existing?.approvals ?? [], approvedHeadSha: changedHead ? null : existing?.approvedHeadSha ?? null, approvedById: changedHead ? null : existing?.approvedById ?? null, approvedAt: changedHead ? null : existing?.approvedAt ?? null, mergedHeadSha: changedHead ? null : existing?.mergedHeadSha ?? null, mergedById: changedHead ? null : existing?.mergedById ?? null, mergedAt: changedHead ? null : existing?.mergedAt ?? null, updatedAt: this.now() };
      const saved = await r.gates.save(gate);
      if (changedHead) {
        const reviewStatus = project.availableStatuses.includes("IN_REVIEW") ? "IN_REVIEW" : project.availableStatuses.includes("READY_FOR_REVIEW") ? "READY_FOR_REVIEW" : null;
        if (reviewStatus && task.status !== reviewStatus) {
          const changed = await r.tasks.update(taskId, { status: reviewStatus });
          await enqueueTaskStatusWebhook(r, changed, task.status, context, null, undefined, this.now);
        }
      }
      return saved;
    });
  }

  async approve(context: RequestContext, taskId: string, headSha: string) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); const project = await this.authorize(r, context, task.projectId);
      if (context.actor.kind !== "AGENT" || !context.actor.tokenScopes?.includes("task:gate:approve")) throw new ForbiddenError("Only an agent with the task:gate:approve capability can approve a task gate");
      const policy = project.reviewPolicy;
      const blockingFindings = r.findings ? (await r.findings.listForTask(taskId)).filter((finding) => ["P0", "P1", "P2"].includes(finding.severity) && ["OPEN", "FIX_NEEDED", "DEFERRED", "ESCALATED"].includes(finding.disposition)) : [];
      if (blockingFindings.length) throw new ValidationError(`Blocking review findings must be resolved before approval: ${blockingFindings.map((finding) => finding.id).join(", ")}`);
      const gate = await this.requireReady(r, taskId, headSha);
      if (policy.requireIndependentReview && (!gate.implementationAgentId || gate.implementationAgentId === context.actor.userId)) throw new ForbiddenError("The implementing agent cannot approve its own work");
      if (policy.allowedReviewerAgentIds.length && !policy.allowedReviewerAgentIds.includes(context.actor.userId)) throw new ForbiddenError("This agent is not allowed by the project review policy");
      const approved = await r.gates.approve(taskId, headSha, context.actor.userId, { requiredReviewerCount: policy.requiredReviewerCount, excludedReviewerId: policy.requireIndependentReview ? gate.implementationAgentId : null, allowedReviewerIds: policy.allowedReviewerAgentIds }, this.now()); if (!approved) throw new ValidationError("The PR head changed before approval");
      const eligibleReviewerCount = this.eligibleApprovals(approved, project.reviewPolicy).length;
      await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.gate_approved", metadata: { headSha, requiredChecks: gate.requiredChecks, implementationRunId: gate.implementationRunId, reviewerCount: eligibleReviewerCount, requiredReviewerCount: policy.requiredReviewerCount } }); return approved;
    });
  }

  async merge(context: RequestContext, taskId: string, headSha: string) {
    return this.unitOfWork.run(async (r) => {
      const task = await r.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); const project = await this.authorize(r, context, task.projectId);
      if (context.actor.kind !== "HUMAN" || (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId)) throw new ForbiddenError("Only a project owner or administrator can authorize a merge");
      await this.requireReady(r, taskId, headSha); const gate = await r.gates.findByTask(taskId); if (!gate?.approvedHeadSha || gate.approvedHeadSha !== headSha) throw new ValidationError("A Codex approval for the current PR head is required before merging");
      const eligibleApprovals = this.eligibleApprovals(gate, project.reviewPolicy);
      if (project.reviewPolicy.requireIndependentReview && !gate.implementationAgentId) throw new ValidationError("Independent review requires recorded implementation provenance for the current PR head");
      if (eligibleApprovals.length < project.reviewPolicy.requiredReviewerCount) throw new ValidationError(`The current review policy requires ${project.reviewPolicy.requiredReviewerCount} eligible agent approval(s)`);
      const merged = await r.gates.merge(taskId, headSha, context.actor.userId, this.now()); if (!merged) throw new ValidationError("The PR head changed before merge authorization");
      await r.tasks.update(taskId, { pullRequestState: "MERGED" }); await r.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.merge_authorized", metadata: { headSha, approvedById: gate.approvedById } }); return merged;
    });
  }

  private async requireReady(r: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], taskId: string, headSha: string) {
    if (!sha(headSha)) throw new ValidationError("headSha must be a commit SHA"); const gate = await r.gates.findByTask(taskId); if (!gate || gate.headSha !== headSha) throw new ValidationError("Gate evidence is missing for the current PR head");
    const required = new Set(gate.requiredChecks); const passed = new Set(gate.checks.filter((check) => check.headSha === headSha && check.status === "PASS").map((check) => check.name)); const missing = [...required].filter((check) => !passed.has(check)); if (missing.length) throw new ValidationError(`Required CI checks are not passing for this PR head: ${missing.join(", ")}`);
    const requiredArtifacts = gate.requiredArtifactTypes ?? [];
    if (requiredArtifacts.length) { const artifacts = await r.artifacts.listForTask(taskId, headSha); const present = new Set(artifacts.map((artifact) => artifact.type)); const missingArtifacts = requiredArtifacts.filter((type) => !present.has(type)); if (missingArtifacts.length) throw new ValidationError(`Required run artifacts are missing for this PR head: ${missingArtifacts.join(", ")}`); }
    return gate;
  }
  private validateEvidence(input: Pick<TaskGateEntity, "headSha" | "requiredChecks" | "checks"> & { requiredArtifactTypes?: AgentArtifactType[] }) { if (!sha(input.headSha)) throw new ValidationError("headSha must be a commit SHA"); if (!input.requiredChecks.length) throw new ValidationError("At least one required CI check must be configured"); if (new Set(input.requiredChecks).size !== input.requiredChecks.length) throw new ValidationError("Required CI checks must be unique"); if (input.requiredArtifactTypes && new Set(input.requiredArtifactTypes).size !== input.requiredArtifactTypes.length) throw new ValidationError("Required artifact types must be unique"); if (new Set(input.checks.map((check) => check.name)).size !== input.checks.length) throw new ValidationError("CI check evidence names must be unique"); if (input.checks.some((check) => !sha(check.headSha) || !check.name || !["PASS", "FAIL", "PENDING"].includes(check.status))) throw new ValidationError("Invalid CI check evidence"); const names = new Set(input.checks.map((check) => check.name)); if (input.requiredChecks.some((name) => !names.has(name))) throw new ValidationError("Evidence must include every required CI check"); }
  private eligibleApprovals(gate: TaskGateEntity, policy: { requireIndependentReview: boolean; allowedReviewerAgentIds: string[] }) { return gate.approvals.filter((approval) => (!policy.requireIndependentReview || approval.reviewerId !== gate.implementationAgentId) && (!policy.allowedReviewerAgentIds.length || policy.allowedReviewerAgentIds.includes(approval.reviewerId))); }
  private async authorize(r: Parameters<Parameters<UnitOfWork["run"]>[0]>[0], context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
