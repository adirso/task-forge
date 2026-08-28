import { ForbiddenError, NotFoundError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export class DeliveryMonitorApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  async health(context: RequestContext, pollIntervalMs: number) {
    return this.unitOfWork.run((repositories) => repositories.deliveryMonitor.health(new Date().toISOString(), pollIntervalMs));
  }

  async taskCheckpoint(context: RequestContext, taskId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const task = await repositories.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      const project = await repositories.projects.findById(task.projectId);
      if (!project) throw new NotFoundError("Project");
      if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(project.id, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
      return repositories.deliveryMonitor.taskCheckpoint(taskId);
    });
  }
}
