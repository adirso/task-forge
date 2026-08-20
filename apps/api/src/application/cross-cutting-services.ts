import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { NotificationEntity, TaskEntity } from "./models.js";
import type { ContextService, NotificationService, SearchService } from "./services.js";
import type { UnitOfWork } from "./repositories.js";

export class NotificationApplicationService implements NotificationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async list(context: RequestContext) { return this.unitOfWork.run((repositories) => repositories.notifications.listForUser(context.actor.userId)); }
  async markRead(context: RequestContext, notificationId: string) { return this.unitOfWork.run(async (repositories) => { try { return await repositories.notifications.markRead(context.actor.userId, notificationId); } catch { throw new NotFoundError("Notification"); } }); }
  async markAllRead(context: RequestContext) { return this.unitOfWork.run((repositories) => repositories.notifications.markAllRead(context.actor.userId)); }
}

export class SearchApplicationService implements SearchService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async search(context: RequestContext, query: string): Promise<TaskEntity[]> { return this.unitOfWork.run((repositories) => repositories.search.searchAccessible({ actorId: context.actor.userId, isAdmin: context.actor.role === "ADMIN", query })); }
}

export class ContextApplicationService implements ContextService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async resolve(context: RequestContext, input: { project?: string; task?: string }) {
    return this.unitOfWork.run(async (repositories) => {
      if (!input.project && !input.task) throw new ValidationError("Provide a project or task query parameter");
      let task = null;
      if (input.task) {
        if (/^[0-9a-f-]{36}$/i.test(input.task)) task = await repositories.tasks.findById(input.task);
        else { const match = input.task.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/); if (!match) throw new ValidationError("Task must be a UUID or a key such as TF-42"); const key = match[1]!; const project = await repositories.projects.findByKey(key); if (project) task = await repositories.tasks.findByProjectNumber(project.id, Number(match[2])); }
        if (!task) throw new NotFoundError("Task");
      }
      const project = input.project ? await repositories.projects.findById(input.project) ?? await repositories.projects.findByKey(input.project) : task ? await repositories.projects.findById(task.projectId) : null;
      if (!project) throw new NotFoundError("Project");
      if (task && task.projectId !== project.id) throw new ValidationError("The task does not belong to the requested project");
      if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(project.id, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
      if (!task) return { project, task: null };
      const [phase, updates] = await Promise.all([
        task.phaseId ? repositories.phases.findById(task.phaseId) : Promise.resolve(null),
        repositories.updates.listForTask(task.id),
      ]);
      const hydratedUpdates = await Promise.all(updates.map(async (update) => ({ ...update, author: await repositories.users.findById(update.authorId) ?? undefined })));
      return { project, task: { ...task, phase, updates: hydratedUpdates } };
    });
  }
}
