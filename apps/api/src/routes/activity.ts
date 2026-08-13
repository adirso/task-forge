import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { createRepositories } from "../infrastructure/repositories.js";
import { ForbiddenError, NotFoundError } from "../application/errors.js";

type ActivityQuery = { projectId?: string; taskId?: string; actorId?: string; limit?: string };

export async function activityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Querystring: ActivityQuery }>("/", { schema: { tags: ["Activity"], summary: "List activity events" } }, async (request) => {
    const { projectId, taskId, actorId, limit } = request.query;
    const { authUser } = request;
    const repos = createRepositories(db);

    // Resolve which project to scope access check to
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && taskId) {
      const task = await repos.tasks.findById(taskId);
      if (!task) throw new NotFoundError("Task");
      resolvedProjectId = task.projectId;
    }

    // If scoping to a project, verify membership
    if (resolvedProjectId) {
      if (authUser.role !== "ADMIN" && !(await repos.memberships.isMember(resolvedProjectId, authUser.id))) {
        throw new ForbiddenError("You are not a member of this project");
      }
    } else if (authUser.role !== "ADMIN") {
      // Without a project/task filter, admins can list all; members cannot
      throw new ForbiddenError("Provide a projectId or taskId to filter activity");
    }

    const parsedLimit = limit ? Math.min(Number(limit), 200) : 50;
    const activity = await repos.activity.list({ projectId, taskId, actorId, limit: parsedLimit });
    return { activity };
  });
}
