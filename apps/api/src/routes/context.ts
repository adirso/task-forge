import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { ContextApplicationService } from "../application/cross-cutting-services.js";

type ContextQuery = { project?: string; task?: string };
const service = new ContextApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });

export async function contextRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Querystring: ContextQuery }>("/", { schema: { tags: ["Context"], summary: "Resolve shareable project and task query parameters" } }, async (request) => service.resolve(context(request), request.query));
}
