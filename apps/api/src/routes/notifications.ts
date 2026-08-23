import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { NotificationApplicationService } from "../application/cross-cutting-services.js";
import { pageRequest } from "../infrastructure/pagination.js";

type NotificationParams = { id: string };
type NotificationQuery = { cursor?: string; limit?: string };
const service = new NotificationApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Querystring: NotificationQuery }>("/", { schema: { tags: ["Notifications"], summary: "List the current user's notifications" } }, async (request) => { const result = await service.list(context(request), pageRequest(request.query)); return { notifications: result.items, unreadCount: result.unreadCount, page: result.page }; });
  app.patch<{ Params: NotificationParams }>("/:id/read", { schema: { tags: ["Notifications"], summary: "Mark a notification as read" } }, async (request) => ({ notification: await service.markRead(context(request), request.params.id) }));
  app.post("/read-all", { schema: { tags: ["Notifications"], summary: "Mark all notifications as read" } }, async (request) => ({ updated: await service.markAllRead(context(request)) }));
}
