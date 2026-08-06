import { randomUUID } from "node:crypto";
import type { TaskStatus } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { ProjectContext, RequestContext } from "./context.js";
import type { TaskDependencyEntity, TaskEntity, TaskUpdateEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";
import type { TaskCreateInput, TaskFilters, TaskService, TaskUpdateInput } from "./services.js";

export class TaskApplicationService implements TaskService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID) {}

  async list(context: ProjectContext, filters?: TaskFilters) { return this.unitOfWork.run(async (repositories) => { await this.assertProjectAccess(repositories, context); return repositories.tasks.listByProject(context.projectId, filters); }); }

  async get(context: RequestContext, taskId: string) { return this.unitOfWork.run(async (repositories) => { const task = await this.requireTask(repositories, taskId); await this.assertProjectAccess(repositories, context, task.projectId); return task; }); }

  async create(context: ProjectContext, input: TaskCreateInput) {
    return this.unitOfWork.run(async (repositories) => {
      await this.assertProjectAccess(repositories, context);
      await this.validateRelations(repositories, context.projectId, null, input);
      const allocation = await repositories.tasks.allocateNumber(context.projectId, input.status);
      const now = this.now();
      const task: TaskEntity = { ...input, id: this.newId(), projectId: context.projectId, number: allocation.number, position: allocation.position, creatorId: context.actor.userId, createdAt: now, updatedAt: now };
      await repositories.tasks.create(task);
      await this.replaceMetadata(repositories, task, input.tags, input.dependencyIds, now);
      await repositories.activity.record({ projectId: task.projectId, taskId: task.id, actorId: context.actor.userId, action: "task.created", metadata: { title: task.title } });
      if (task.assigneeId && task.assigneeId !== context.actor.userId) await this.notify(repositories, task.assigneeId, task, context, "TASK_ASSIGNED", "Task assigned to you");
      return task;
    });
  }

  async update(context: RequestContext, taskId: string, input: TaskUpdateInput) {
    return this.unitOfWork.run(async (repositories) => {
      const existing = await this.requireTask(repositories, taskId);
      await this.assertProjectAccess(repositories, context, existing.projectId);
      await this.validateRelations(repositories, existing.projectId, taskId, input);
      const { tags, dependencyIds, ...fields } = input;
      const now = this.now();
      const task = Object.keys(fields).length ? await repositories.tasks.update(taskId, fields) : existing;
      if (!Object.keys(fields).length) await repositories.tasks.update(taskId, { updatedAt: now });
      await this.replaceMetadata(repositories, { ...task, updatedAt: now }, tags, dependencyIds, now);
      await repositories.activity.record({ projectId: existing.projectId, taskId, actorId: context.actor.userId, action: "task.updated", metadata: input });
      if (input.assigneeId && input.assigneeId !== existing.assigneeId && input.assigneeId !== context.actor.userId) await this.notify(repositories, input.assigneeId, { ...existing, ...task, title: input.title ?? existing.title }, context, "TASK_ASSIGNED", "Task assigned to you");
      if (input.status === "IN_REVIEW" && existing.status !== "IN_REVIEW" && existing.creatorId !== context.actor.userId) await this.notify(repositories, existing.creatorId, { ...existing, ...task, title: input.title ?? existing.title }, context, "REVIEW_REQUESTED", "Review requested");
      return { ...task, updatedAt: now };
    });
  }

  async delete(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (repositories) => { const task = await this.requireTask(repositories, taskId); await this.assertProjectAccess(repositories, context, task.projectId); await repositories.tasks.delete(taskId); });
  }

  async addUpdate(context: RequestContext, taskId: string, body: string): Promise<TaskUpdateEntity> {
    return this.unitOfWork.run(async (repositories) => {
      const task = await this.requireTask(repositories, taskId);
      await this.assertProjectAccess(repositories, context, task.projectId);
      const now = this.now();
      const update: TaskUpdateEntity = { id: this.newId(), taskId, authorId: context.actor.userId, body, createdAt: now, updatedAt: now };
      await repositories.updates.create(update);
      await repositories.activity.record({ projectId: task.projectId, taskId, actorId: context.actor.userId, action: "task.note_added" });
      const recipients = new Set([task.creatorId, task.assigneeId].filter((id): id is string => Boolean(id && id !== context.actor.userId)));
      for (const recipientId of recipients) await repositories.notifications.notify({ userId: recipientId, projectId: task.projectId, taskId, type: "TASK_UPDATED", title: "New task update", message: `${context.actor.name ?? "A teammate"} posted an update on “${task.title}”.` });
      return update;
    });
  }

  private async assertProjectAccess(repositories: RepositorySet, context: RequestContext, projectId?: string) {
    const target = projectId ?? (context as ProjectContext).projectId;
    const project = await repositories.projects.findById(target);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(target, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
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
}
