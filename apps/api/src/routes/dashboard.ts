import type { FastifyInstance } from "fastify";
import { DashboardApplicationService } from "../application/cross-cutting-services.js";
import type { TokenScope } from "../application/context.js";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";

const service = new DashboardApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as TokenScope[] | null } });

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get("/summary", { schema: { tags: ["Dashboard"], summary: "Dashboard summary for home screen widgets" } }, async (request) => service.summary(context(request)));
}
