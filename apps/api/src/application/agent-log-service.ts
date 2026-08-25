import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentLogEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";
import type { AgentLogService } from "./services.js";

const MAX_LOG_CONTENT = 10_000;
const MAX_LOGS_PER_TASK = 5_000;

function redact(value: string) {
  return value
    .replace(/(authorization\s*:\s*bearer\s+|\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\btf_[A-Za-z0-9_-]+\b/g, "tf_[REDACTED]")
    .replace(/\b(?:sk|whsec)_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

export class AgentLogApplicationService implements AgentLogService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID) {}

  async list(context: RequestContext, taskId: string, page: { limit: number; cursor?: string }) {
    return this.unitOfWork.run(async (repositories) => {
      const task = await repositories.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      await this.authorize(repositories, context, task.projectId);
      return repositories.agentLogs.listForTask(taskId, page);
    });
  }

  async append(context: RequestContext, taskId: string, input: Omit<AgentLogEntity, "id" | "taskId" | "createdAt">) {
    return this.unitOfWork.run(async (repositories) => {
      const task = await repositories.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      await this.authorize(repositories, context, task.projectId);
      if (!Number.isInteger(input.sequence) || input.sequence < 0) throw new ValidationError("Agent log sequence must be a non-negative integer");
      if (!input.content.trim()) throw new ValidationError("Agent log content is required");
      if (input.content.length > MAX_LOG_CONTENT) throw new ValidationError(`Agent log content cannot exceed ${MAX_LOG_CONTENT} characters`);
      if (input.runId) {
        const run = await repositories.runs.findById(input.runId);
        if (!run || run.taskId !== taskId) throw new ValidationError("runId must reference a run for this task");
      }
      const log: AgentLogEntity = { ...input, id: this.newId(), taskId, content: redact(input.content).slice(0, MAX_LOG_CONTENT), createdAt: this.now() };
      const created = await repositories.agentLogs.append(log);
      if (created) await repositories.agentLogs.purgeForTask(taskId, MAX_LOGS_PER_TASK);
      return created;
    });
  }

  private async authorize(repositories: RepositorySet, context: RequestContext, projectId: string) {
    const project = await repositories.projects.findById(projectId);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
    return project;
  }
}
