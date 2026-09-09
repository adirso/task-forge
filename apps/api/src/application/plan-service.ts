import { randomUUID } from "node:crypto";
import type { AgentPlanDecision, AgentPlanProposal } from "@taskforge/contracts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.js";
import type { RequestContext, TokenScope } from "./context.js";
import type { AgentPlanEntity, ProjectEntity, TaskEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export class AgentPlanApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID) {}

  async list(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const { task } = await this.authorizeTask(repositories, context, taskId);
      return repositories.plans.listForTask(task.id);
    });
  }

  async propose(context: RequestContext, taskId: string, idempotencyKey: string, input: AgentPlanProposal) {
    return this.unitOfWork.run(async (repositories) => {
      this.assertScope(context, "task:plan");
      const { task, project } = await this.authorizeTask(repositories, context, taskId);
      if (context.actor.kind !== "AGENT") throw new ForbiddenError("Only an agent can propose an execution plan");
      const run = await repositories.runs.findById(input.sourceRunId);
      if (!run || run.taskId !== task.id || run.projectId !== task.projectId) throw new ForbiddenError("Source run is not assigned to this task");
      if (run.status !== "RUNNING" || run.controlState !== "ACTIVE" || run.leaseOwner !== context.actor.userId) throw new ConflictError("Only the current run lease owner can propose a plan");
      await repositories.plans.lockTask(task.id);
      const duplicate = await repositories.plans.findByIdempotency(input.sourceRunId, idempotencyKey);
      if (duplicate) return { plan: duplicate, duplicate: true };

      const now = this.now();
      const plan: AgentPlanEntity = {
        id: this.newId(), taskId: task.id, sourceRunId: input.sourceRunId, version: await repositories.plans.nextVersion(task.id), status: "PROPOSED",
        summary: input.summary, risks: input.risks, acceptanceEvidence: input.acceptanceEvidence, requiresApproval: input.requiresApproval, items: input.items,
        createdTaskIds: {}, idempotencyKey, proposedById: context.actor.userId, reviewedById: null, reviewComment: null, createdAt: now, reviewedAt: null,
      };
      await repositories.plans.create(plan);
      await repositories.activity.record({ projectId: project.id, taskId: task.id, actorId: context.actor.userId, action: "agent_plan.proposed", metadata: { planId: plan.id, version: plan.version, sourceRunId: plan.sourceRunId, requiresApproval: plan.requiresApproval, itemCount: plan.items.length } });
      if (!plan.requiresApproval) return { plan: await this.apply(repositories, task, project, plan, context.actor.userId, "Approval was not required"), duplicate: false };
      return { plan, duplicate: false };
    });
  }

  async decide(context: RequestContext, taskId: string, planId: string, input: AgentPlanDecision) {
    return this.unitOfWork.run(async (repositories) => {
      const { task, project } = await this.authorizeTask(repositories, context, taskId);
      if (context.actor.kind !== "HUMAN" || (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId)) throw new ForbiddenError("Only the project owner or an administrator can review plans");
      const plan = await repositories.plans.findById(planId);
      if (!plan || plan.taskId !== task.id) throw new NotFoundError("Agent plan");
      const desired = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
      if (plan.status === desired) return { plan, duplicate: true };
      if (plan.status !== "PROPOSED") throw new ConflictError(`Plan was already ${plan.status.toLowerCase()}`);
      if (desired === "APPROVED") return { plan: await this.apply(repositories, task, project, plan, context.actor.userId, input.comment ?? null), duplicate: false };
      const reviewedAt = this.now();
      if (!(await repositories.plans.decide(plan.id, "PROPOSED", { status: "REJECTED", createdTaskIds: {}, reviewedById: context.actor.userId, reviewComment: input.comment ?? null, reviewedAt }))) throw new ConflictError("Plan changed while it was being reviewed");
      await repositories.activity.record({ projectId: project.id, taskId: task.id, actorId: context.actor.userId, action: "agent_plan.rejected", metadata: { planId: plan.id, version: plan.version } });
      return { plan: (await repositories.plans.findById(plan.id))!, duplicate: false };
    });
  }

  private async apply(repositories: RepositorySet, sourceTask: TaskEntity, project: ProjectEntity, plan: AgentPlanEntity, reviewerId: string, comment: string | null) {
    const reviewedAt = this.now();
    if (!(await repositories.plans.decide(plan.id, "PROPOSED", { status: "APPROVED", createdTaskIds: {}, reviewedById: reviewerId, reviewComment: comment, reviewedAt }))) throw new ConflictError("Plan changed while it was being reviewed");
    const createdTaskIds: Record<string, string> = {};
    for (const item of plan.items) {
      const allocation = await repositories.tasks.allocateNumber(sourceTask.projectId, project.defaultStatus);
      const task: TaskEntity = {
        id: this.newId(), projectId: sourceTask.projectId, number: allocation.number, title: item.title, description: item.description, definitionOfDone: item.definitionOfDone,
        status: project.defaultStatus, priority: item.priority, type: item.type, assigneeId: null, creatorId: reviewerId, parentId: sourceTask.id, branch: null, dueDate: null,
        estimatePoints: item.estimatePoints, phaseId: sourceTask.phaseId, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: allocation.position, createdAt: reviewedAt, updatedAt: reviewedAt,
      };
      await repositories.tasks.create(task);
      createdTaskIds[item.key] = task.id;
      await repositories.activity.record({ projectId: project.id, taskId: task.id, actorId: reviewerId, action: "task.created_from_plan", metadata: { planId: plan.id, planVersion: plan.version, itemKey: item.key, sourceTaskId: sourceTask.id } });
    }
    for (const item of plan.items) await repositories.dependencies.replaceForTask(createdTaskIds[item.key]!, item.dependencyKeys.map((key) => createdTaskIds[key]!), reviewedAt);
    if (!(await repositories.plans.decide(plan.id, "APPROVED", { status: "APPROVED", createdTaskIds, reviewedById: reviewerId, reviewComment: comment, reviewedAt }))) throw new ConflictError("Approved plan could not record its created task graph");
    await repositories.activity.record({ projectId: project.id, taskId: sourceTask.id, actorId: reviewerId, action: "agent_plan.approved", metadata: { planId: plan.id, version: plan.version, createdTaskIds } });
    return (await repositories.plans.findById(plan.id))!;
  }

  private assertScope(context: RequestContext, scope: TokenScope) {
    if (context.actor.tokenScopes !== null && !context.actor.tokenScopes.includes(scope)) throw new ForbiddenError(`This token does not have the '${scope}' permission. Required to perform this action.`);
  }

  private async authorizeTask(repositories: RepositorySet, context: RequestContext, taskId: string) {
    const task = await repositories.tasks.findById(taskId);
    if (!task) throw new NotFoundError("Task");
    const project = await repositories.projects.findById(task.projectId);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(project.id, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
    return { task, project };
  }
}
