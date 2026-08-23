import { TASK_STATUSES, type DashboardSummary, type DashboardSummaryTask, type TaskStatus } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { PageRequest, ReportingTaskEntity } from "./models.js";
import type { ActivityService, ContextService, DashboardService, NotificationService, SearchService } from "./services.js";
import type { UnitOfWork } from "./repositories.js";

const STUCK_THRESHOLD_MS = 4 * 60 * 60 * 1000;

const toDashboardTask = (task: ReportingTaskEntity): DashboardSummaryTask => ({
  id: task.id,
  number: task.number,
  title: task.title,
  projectId: task.projectId,
  projectKey: task.projectKey,
  projectName: task.projectName,
  status: task.status,
  assigneeName: task.assigneeName,
  updatedAt: task.updatedAt,
});

export class NotificationApplicationService implements NotificationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async list(context: RequestContext, page: PageRequest) { return this.unitOfWork.run((repositories) => repositories.notifications.listForUser(context.actor.userId, page)); }
  async markRead(context: RequestContext, notificationId: string) { return this.unitOfWork.run(async (repositories) => { try { return await repositories.notifications.markRead(context.actor.userId, notificationId); } catch { throw new NotFoundError("Notification"); } }); }
  async markAllRead(context: RequestContext) { return this.unitOfWork.run((repositories) => repositories.notifications.markAllRead(context.actor.userId)); }
}

export class SearchApplicationService implements SearchService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async search(context: RequestContext, query: string, page: PageRequest) { return this.unitOfWork.run((repositories) => repositories.search.searchAccessible({ actorId: context.actor.userId, isAdmin: context.actor.role === "ADMIN", query, page })); }
}

export class ActivityApplicationService implements ActivityService {
  constructor(private readonly unitOfWork: UnitOfWork) {}
  async list(context: RequestContext, filters: { projectId?: string; taskId?: string; actorId?: string; page: PageRequest }) {
    return this.unitOfWork.run(async (repositories) => {
      let resolvedProjectId = filters.projectId;
      if (!resolvedProjectId && filters.taskId) {
        const task = await repositories.tasks.findById(filters.taskId);
        if (!task) throw new NotFoundError("Task");
        resolvedProjectId = task.projectId;
      }
      if (resolvedProjectId) {
        if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(resolvedProjectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
      } else if (context.actor.role !== "ADMIN") {
        throw new ForbiddenError("Provide a projectId or taskId to filter activity");
      }
      return repositories.activity.list(filters);
    });
  }
}

export class DashboardApplicationService implements DashboardService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString()) {}
  async summary(context: RequestContext): Promise<DashboardSummary> {
    return this.unitOfWork.run(async (repositories) => {
      const accessible = await repositories.projects.listAccessible(context.actor.userId, context.actor.role === "ADMIN");
      const projectsByName = [...accessible].sort((left, right) => left.name.localeCompare(right.name));
      const projectIds = projectsByName.map((project) => project.id);
      const cutoff = new Date(new Date(this.now()).getTime() - STUCK_THRESHOLD_MS).toISOString();
      const [counts, myTasks, stuckTasks] = await Promise.all([
        repositories.reporting.countTasksByProject(projectIds),
        repositories.reporting.listMyOpenTasks(context.actor.userId, 30),
        repositories.reporting.listStuckTasks(projectIds, cutoff, 20),
      ]);
      const countsByProject = new Map<string, Map<TaskStatus, number>>();
      for (const count of counts) {
        const projectCounts = countsByProject.get(count.projectId) ?? new Map<TaskStatus, number>();
        projectCounts.set(count.status, count.count);
        countsByProject.set(count.projectId, projectCounts);
      }
      return {
        projects: projectsByName.map((project) => {
          const projectCounts = countsByProject.get(project.id);
          const statusCounts = Object.fromEntries(TASK_STATUSES.map((status) => [status, projectCounts?.get(status) ?? 0])) as Record<TaskStatus, number>;
          return { id: project.id, name: project.name, key: project.key, color: project.color, counts: { ...statusCounts, total: TASK_STATUSES.reduce((total, status) => total + statusCounts[status], 0) } };
        }),
        myTasks: myTasks.map(toDashboardTask),
        stuckTasks: stuckTasks.map(toDashboardTask),
      };
    });
  }
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
        repositories.updates.listForTask(task.id, { limit: 50 }),
      ]);
      return { project, task: { ...task, phase, updates: updates.items, updatesPage: updates.page } };
    });
  }
}
