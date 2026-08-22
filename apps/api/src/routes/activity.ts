import type { FastifyInstance } from "fastify";
import { ActivityApplicationService } from "../application/cross-cutting-services.js";
import type { TokenScope } from "../application/context.js";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";

type ActivityQuery = { projectId?: string; taskId?: string; actorId?: string; limit?: string };
const service = new ActivityApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as TokenScope[] | null } });

export async function activityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Querystring: ActivityQuery }>("/", { schema: { tags: ["Activity"], summary: "List activity events" } }, async (request) => {
    const { projectId, taskId, actorId, limit } = request.query;
    const requestedLimit = Number(limit);
    const parsedLimit = limit && Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 200) : 50;
    return { activity: await service.list(context(request), { projectId, taskId, actorId, limit: parsedLimit }) };
  });
}
