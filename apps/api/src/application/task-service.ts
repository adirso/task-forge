import { randomUUID } from "node:crypto";
import { TASK_CLAIM_SOURCE_STATUSES, TASK_CLAIM_TARGET_STATUS, TASK_REVIEW_STATUSES, type TaskStatus } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { ProjectContext, RequestContext, TokenScope } from "./context.js";
import type { PageRequest, TaskDependencyEntity, TaskEntity, TaskUpdateEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";
import type { TaskCreateInput, TaskFilters, TaskService, TaskUpdateInput } from "./services.js";
import { AutomationEngine } from "./automation-service.js";

export class TaskApplicationService implements TaskService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID, private readonly automationEngine = new AutomationEngine()) {}

  async list(context: ProjectContext, filters: TaskFilters | undefined, page: PageRequest) { return this.unitOfWork.run(async (repositories) => { await this.assertProjectAccess(repositories, context); return repositories.tasks.listByProject(context.projectId, filters, page); }); }

  private assertScope(context: RequestContext, scope: TokenScope) {
    const { tokenScopes } = context.actor;
    if (tokenScopes !== null && tokenScopes !== undefined && !tokenScopes.includes(scope)) {
      throw new ForbiddenError(`This token does not have the '${scope}' permission. Required to perform this action.`);
    }
  }

  private BRANCH_FIELDS = new Set(["branch", "pullRequestUrl", "pullRequestTitle", "pullRequestState"] as const);
  private META_FIELDS = new Set(["title", "description", "definitionOfDone", "priority", "type", "assigneeId", "parentId", "dueDate", "estimatePoints", "phaseId", "tags", "dependencyIds"] as const);


  async get(context: RequestContext, taskId: string) { return this.unitOfWork.run(async (repositories) => { const task = await this.requireTask(repositories, taskId); await this.assertProjectAccess(repositories, context, task.projectId); return task; }); }

  async create(context: ProjectContext, input: TaskCreateInput) {
    return this.unitOfWork.run(async (repositories) => {
      this.assertScope(context, "task:create");
      const project = await this.assertProjectAccess(repositories, context);
      const phaseId = input.phaseId === undefined ? (await repositories.phases.findActive(context.projectId))?.id ?? null : input.phaseId;
      const normalized = { ...input, description: input.description ?? "", definitionOfDone: input.definitionOfDone ?? "", status: input.status ?? project.defaultStatus, priority: input.priority ?? "MEDIUM", type: input.type ?? "FEATURE", assigneeId: input.assigneeId ?? null, parentId: input.parentId ?? null, branch: input.branch ?? null, dueDate: input.dueDate ?? null, estimatePoints: input.estimatePoints ?? null, phaseId, pullRequestUrl: input.pullRequestUrl ?? null, pullRequestTitle: input.pullRequestTitle ?? null, pullRequestState: input.pullRequestState ?? null };
      this.assertStatusAvailable(project.availableStatuses, normalized.status);
      await this.validateRelations(repositories, context.projectId, null, normalized);
      const allocation = await repositories.tasks.allocateNumber(context.projectId, normalized.status);
      const now = this.now();
      const { tags: _tags, dependencyIds: _dependencyIds, ...taskFields } = normalized;
      const task: TaskEntity = { ...taskFields, id: this.newId(), projectId: context.projectId, number: allocation.number, position: allocation.position, creatorId: context.actor.userId, createdAt: now, updatedAt: now } as TaskEntity;
      await repositories.tasks.create(task);
      await this.replaceMetadata(repositories, task, normalized.tags, normalized.dependencyIds, now);
      await repositories.activity.record({ projectId: task.projectId, taskId: task.id, actorId: context.actor.userId, action: "task.created", metadata: { title: task.title } });
      if (task.assigneeId && task.assigneeId !== context.actor.userId) await this.notify(repositories, task.assigneeId, task, context, "TASK_ASSIGNED", "Task assigned to you");
      const automated = await this.automationEngine.apply(repositories, context, null, task, "TASK_CREATED");
      if (automated.assigneeId && automated.assigneeId !== context.actor.userId) await this.enqueueAssignmentWebhook(repositories, automated, context);
      return repositories.tasks.findById ? await repositories.tasks.findById(automated.id) ?? automated : automated;
    });
  }

  async update(context: RequestContext, taskId: string, input: TaskUpdateInput) {
    return this.unitOfWork.run(async (repositories) => {
      const existing = await this.requireTask(repositories, taskId);
      await this.assertProjectAccess(repositories, context, existing.projectId);
      // Check field-level scopes when token has an explicit scope list
      const hasField = (keys: ReadonlySet<string>) => Object.keys(input).some((k) => keys.has(k));
      if ("status" in input) this.assertScope(context, "task:update:status");
      if (hasField(this.BRANCH_FIELDS)) this.assertScope(context, "task:update:branch");
      if (hasField(this.META_FIELDS)) this.assertScope(context, "task:update:meta");
      if (input.status) {
        const project = await repositories.projects.findById(existing.projectId);
        if (!project) throw new NotFoundError("Project");
        this.assertStatusAvailable(project.availableStatuses, input.status);
        this.assertStatusTransition(project.availableStatuses, existing.status, input.status);
      }
      await this.validateRelations(repositories, existing.projectId, taskId, input);
      const { tags, dependencyIds, runId, ...fields } = input;
      const now = this.now();
      const task = Object.keys(fields).length ? await repositories.tasks.update(taskId, fields) : existing;
      if (!Object.keys(fields).length) await repositories.tasks.update(taskId, { updatedAt: now });
      await this.replaceMetadata(repositories, { ...task, updatedAt: now }, tags, dependencyIds, now);
      await repositories.activity.record({ projectId: existing.projectId, taskId, actorId: context.actor.userId, action: "task.updated", metadata: input });
      const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId;
      if (assigneeChanged && input.assigneeId && input.assigneeId !== context.actor.userId) await this.notify(repositories, input.assigneeId, { ...existing, ...task, title: input.title ?? existing.title }, context, "TASK_ASSIGNED", "Task assigned to you");
      const reviewStatuses = new Set<TaskStatus>(TASK_REVIEW_STATUSES);
      if (input.status && reviewStatuses.has(input.status) && !reviewStatuses.has(existing.status) && existing.creatorId !== context.actor.userId) await this.notify(repositories, existing.creatorId, { ...existing, ...task, title: input.title ?? existing.title }, context, "REVIEW_REQUESTED", "Review requested");
      const automated = await this.automationEngine.apply(repositories, context, existing, { ...task, updatedAt: now }, "TASK_UPDATED");
      if (assigneeChanged && input.assigneeId && input.assigneeId !== context.actor.userId) await this.enqueueAssignmentWebhook(repositories, { ...task, assigneeId: input.assigneeId }, context);
      if (automated.status !== existing.status && automated.assigneeId !== context.actor.userId) await this.enqueueStatusWebhook(repositories, automated, existing.status, context, runId ?? null);
      return repositories.tasks.findById ? await repositories.tasks.findById(automated.id) ?? automated : automated;
    });
  }

  async claimTask(context: ProjectContext, options?: { phaseId?: string | null; priority?: string; runId?: string | null }) {
    return this.unitOfWork.run(async (repositories) => {
      this.assertScope(context, "task:claim");
      const project = await this.assertProjectAccess(repositories, context);
      if (options?.runId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.runId)) throw new ValidationError("runId must be a valid UUID");
      const run = options?.runId ? await repositories.runs.findById(options.runId) : null;
      if (options?.runId && (!run || run.projectId !== context.projectId)) throw new ValidationError("runId must reference a run in this project");
      if (run && !["PENDING", "FAILED"].includes(run.status)) throw new ValidationError("runId must reference a pending or retryable run");
      if (!project.availableStatuses.includes(TASK_CLAIM_TARGET_STATUS)) {
        throw new ValidationError(`Task claiming requires ${TASK_CLAIM_TARGET_STATUS} to be enabled as the claim target. Enable it in project settings before claiming tasks.`);
      }
      const sourceStatuses = TASK_CLAIM_SOURCE_STATUSES.filter((status) => project.availableStatuses.includes(status));
      if (!sourceStatuses.length) {
        throw new ValidationError(`Task claiming requires at least one claim source status (${TASK_CLAIM_SOURCE_STATUSES.join(", ")}) to be enabled. Enable one in project settings before claiming tasks.`);
      }
      const task = await repositories.tasks.claimNext(context.projectId, context.actor.userId, { sourceStatuses, targetStatus: TASK_CLAIM_TARGET_STATUS }, { ...options, taskId: run?.taskId });
      if (!task) throw new NotFoundError("No unclaimed tasks match the given criteria");
      await repositories.activity.record({ projectId: task.projectId, taskId: task.id, actorId: context.actor.userId, action: "task.claimed" });
      if (task.assigneeId !== context.actor.userId) await this.enqueueStatusWebhook(repositories, task, task.previousStatus ?? "TODO", context, options?.runId ?? null);
      return task;
    });
  }

  async delete(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (repositories) => {
      this.assertScope(context, "task:delete");
      const task = await this.requireTask(repositories, taskId);
      await this.assertProjectAccess(repositories, context, task.projectId);
      await repositories.tasks.delete(taskId);
    });
  }

  async addUpdate(context: RequestContext, taskId: string, body: string): Promise<TaskUpdateEntity> {
    return this.unitOfWork.run(async (repositories) => {
      this.assertScope(context, "task:update:notes");
      const task = await this.requireTask(repositories, taskId);
      await this.assertProjectAccess(repositories, context, task.projectId);
      const now = this.now();
      const update: TaskUpdateEntity = { id: this.newId(), taskId, authorId: context.actor.userId, body, createdAt: now, updatedAt: now };
      await repositories.updates.create(update);
      await repositories.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.note_added" });
      const recipients = new Set([task.creatorId, task.assigneeId].filter((id): id is string => Boolean(id && id !== context.actor.userId)));
      for (const recipientId of recipients) await repositories.notifications.notify({ userId: recipientId, projectId: task.projectId, taskId, type: "TASK_UPDATED", title: "New task update", message: `${context.actor.name ?? "A teammate"} posted an update on “${task.title}”.` });
      if (task.assigneeId !== context.actor.userId) await this.enqueueUpdateWebhook(repositories, task, update, context);
      return { ...update, author: await repositories.users.findById(update.authorId) ?? undefined };
    });
  }

  async listUpdates(context: RequestContext, taskId: string, page: PageRequest) {
    return this.unitOfWork.run(async (repositories) => { const task = await this.requireTask(repositories, taskId); await this.assertProjectAccess(repositories, context, task.projectId); return repositories.updates.listForTask(taskId, page); });
  }

  async listTags(context: ProjectContext) {
    return this.unitOfWork.run(async (repositories) => { await this.assertProjectAccess(repositories, context); return repositories.tags.listForProject(context.projectId); });
  }

  private async assertProjectAccess(repositories: RepositorySet, context: RequestContext, projectId?: string) {
    const target = projectId ?? (context as ProjectContext).projectId;
    const project = await repositories.projects.findById(target);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(target, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
    return project;
  }

  private assertStatusAvailable(availableStatuses: TaskStatus[], status: TaskStatus) {
    if (!availableStatuses.includes(status)) throw new ValidationError(`Status ${status} is not available in this project`);
  }

  private assertStatusTransition(availableStatuses: TaskStatus[], from: TaskStatus, to: TaskStatus) {
    if (from === to || !availableStatuses.some((status) => ["APPROVED", "RE_REVIEW", "FIX_NEEDED", "PENDING_DECISION", "FAILED"].includes(status))) return;
    const allowed: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
      BACKLOG: ["REFINING", "TODO", "READY_FOR_DEV", "CANCELLED"],
      REFINING: ["TODO", "READY_FOR_DEV", "CANCELLED"],
      TODO: ["REFINING", "READY_FOR_DEV", "IN_PROGRESS", "CANCELLED"],
      READY_FOR_DEV: ["TODO", "IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["TODO", "READY_FOR_REVIEW", "RE_REVIEW", "FAILED", "CANCELLED"],
      READY_FOR_REVIEW: ["IN_PROGRESS", "IN_REVIEW", "RE_REVIEW", "CANCELLED"],
      IN_REVIEW: ["APPROVED", "FIX_NEEDED", "PENDING_DECISION", "FAILED", "CANCELLED"],
      RE_REVIEW: ["APPROVED", "FIX_NEEDED", "PENDING_DECISION", "FAILED", "CANCELLED"],
      FIX_NEEDED: ["IN_PROGRESS", "CANCELLED"],
      PENDING_DECISION: ["IN_PROGRESS", "IN_REVIEW", "CANCELLED"],
      APPROVED: ["DONE", "IN_REVIEW", "FAILED", "CANCELLED"],
      FAILED: ["IN_PROGRESS", "CANCELLED"],
    };
    if (!allowed[from]?.includes(to)) throw new ValidationError(`Status transition ${from} -> ${to} is not allowed by the project workflow`);
  }

  private async requireTask(repositories: RepositorySet, taskId: string) { const task = await repositories.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); return task; }

  private async validateRelations(repositories: RepositorySet, projectId: string, taskId: string | null, input: Partial<TaskCreateInput & TaskUpdateInput>) {
    if (input.assigneeId && !(await repositories.memberships.isMember(projectId, input.assigneeId))) throw new ValidationError("Assignee is not a project member");
    if (input.parentId) { const parent = await repositories.tasks.findById(input.parentId); if (!parent || parent.projectId !== projectId) throw new ValidationError("Parent task is not in this project"); if (taskId && await this.parentCycle(repositories, taskId, input.parentId)) throw new ValidationError("Parent relationship would create a cycle"); }
    if (input.phaseId) { const phase = await repositories.phases.findById(input.phaseId); if (!phase || phase.projectId !== projectId) throw new ValidationError("Phase is not in this project"); }
    if (input.dependencyIds !== undefined) { for (const dependencyId of new Set(input.dependencyIds)) { const dependency = await repositories.tasks.findById(dependencyId); if (!dependency || dependency.projectId !== projectId) throw new ValidationError("Dependency is not in this project"); if (taskId && dependencyId === taskId) throw new ValidationError("A task cannot depend on itself"); if (taskId && await this.dependencyCycle(repositories, dependencyId, taskId, new Set())) throw new ValidationError("Dependency relationship would create a cycle"); } }
  }

  private async parentCycle(repositories: RepositorySet, taskId: string, parentId: string): Promise<boolean> { let cursor: string | null = parentId; const seen = new Set<string>(); while (cursor) { if (cursor === taskId) return true; if (seen.has(cursor)) return true; seen.add(cursor); cursor = (await repositories.tasks.findById(cursor))?.parentId ?? null; } return false; }

  private async dependencyCycle(repositories: RepositorySet, cursor: string, target: string, seen: Set<string>): Promise<boolean> { if (cursor === target) return true; if (seen.has(cursor)) return false; seen.add(cursor); const dependencies = await repositories.dependencies.listForTask(cursor); for (const dependency of dependencies) if (await this.dependencyCycle(repositories, dependency.dependsOnTaskId, target, seen)) return true; return false; }

  private async replaceMetadata(repositories: RepositorySet, task: TaskEntity, tags: string[] | undefined, dependencyIds: string[] | undefined, now: string) { if (tags !== undefined) await repositories.tags.replaceForTask(task.id, task.projectId, tags, now); if (dependencyIds !== undefined) await repositories.dependencies.replaceForTask(task.id, dependencyIds, now); }

  private async notify(repositories: RepositorySet, userId: string, task: TaskEntity, context: RequestContext, type: string, title: string) { await repositories.notifications.notify({ userId, projectId: task.projectId, taskId: task.id, type, title, message: `${context.actor.name ?? "A teammate"} updated “${task.title}”.` }); }

  private async enqueueAssignmentWebhook(repositories: RepositorySet, task: TaskEntity, context: RequestContext) {
    if (!task.assigneeId) return;
    const assignee = await repositories.users.findById(task.assigneeId);
    if (!assignee || assignee.kind !== "AGENT" || !assignee.webhookUrl) return;
    const project = await repositories.projects.findById(task.projectId);
    const id = this.newId();
    const timestamp = this.now();
    const payload = {
      id,
      event: "task.assigned",
      task: {
        id: task.id, number: task.number, title: task.title,
        description: task.description, definitionOfDone: task.definitionOfDone,
        status: task.status, priority: task.priority, type: task.type,
        branch: task.branch, projectId: task.projectId,
        projectKey: project?.key, projectName: project?.name,
        assigneeId: task.assigneeId,
      },
      assignedBy: { id: context.actor.userId, name: context.actor.name },
      timestamp,
    };
    await repositories.webhookDeliveries.create({ id, agentId: assignee.id, taskId: task.id, eventType: "task.assigned", payload: JSON.stringify(payload), status: "PENDING", attemptCount: 0, nextAttemptAt: timestamp, lockedUntil: null, lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null, createdAt: timestamp, updatedAt: timestamp });
  }

  private async enqueueUpdateWebhook(repositories: RepositorySet, task: TaskEntity, update: TaskUpdateEntity, context: RequestContext) {
    if (!task.assigneeId) return;
    const assignee = await repositories.users.findById(task.assigneeId);
    if (!assignee || assignee.kind !== "AGENT" || !assignee.webhookUrl) return;
    const project = await repositories.projects.findById(task.projectId);
    const id = this.newId();
    const payload = {
      id,
      event: "task.update_added",
      task: {
        id: task.id, number: task.number, title: task.title,
        description: task.description, definitionOfDone: task.definitionOfDone,
        status: task.status, priority: task.priority, type: task.type,
        branch: task.branch, projectId: task.projectId,
        projectKey: project?.key, projectName: project?.name,
        assigneeId: task.assigneeId,
      },
      update: { id: update.id, body: update.body, authorId: update.authorId, createdAt: update.createdAt },
      postedBy: { id: context.actor.userId, name: context.actor.name },
      timestamp: update.createdAt,
    };
    await repositories.webhookDeliveries.create({ id, agentId: assignee.id, taskId: task.id, eventType: "task.update_added", payload: JSON.stringify(payload), status: "PENDING", attemptCount: 0, nextAttemptAt: update.createdAt, lockedUntil: null, lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null, createdAt: update.createdAt, updatedAt: update.createdAt });
  }

  private async enqueueStatusWebhook(repositories: RepositorySet, task: TaskEntity, previousStatus: TaskStatus, context: RequestContext, runId: string | null = null) {
    if (!task.assigneeId) return;
    const assignee = await repositories.users.findById(task.assigneeId);
    if (!assignee || assignee.kind !== "AGENT" || !assignee.webhookUrl) return;
    const project = await repositories.projects.findById(task.projectId);
    const id = this.newId();
    const timestamp = this.now();
    const payload = {
      id,
      event: "task.status_changed",
      task: {
        id: task.id, number: task.number, title: task.title,
        description: task.description, definitionOfDone: task.definitionOfDone,
        status: task.status, priority: task.priority, type: task.type,
        branch: task.branch, projectId: task.projectId,
        projectKey: project?.key, projectName: project?.name,
        assigneeId: task.assigneeId,
      },
      previousStatus,
      runId,
      changedBy: { id: context.actor.userId, name: context.actor.name },
      timestamp,
    };
    await repositories.webhookDeliveries.create({ id, agentId: assignee.id, taskId: task.id, eventType: "task.status_changed", payload: JSON.stringify(payload), status: "PENDING", attemptCount: 0, nextAttemptAt: timestamp, lockedUntil: null, lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null, createdAt: timestamp, updatedAt: timestamp });
  }
}
