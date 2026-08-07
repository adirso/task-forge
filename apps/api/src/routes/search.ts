import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { SearchApplicationService } from "../application/cross-cutting-services.js";

type SearchQuery = { q?: string };
const service = new SearchApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });

export async function searchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Querystring: SearchQuery }>("/", { schema: { tags: ["Search"], summary: "Search accessible tasks across projects" } }, async (request) => ({ results: request.query.q?.trim() ? await service.search(context(request), request.query.q.trim()) : [] }));
}
