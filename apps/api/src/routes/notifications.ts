import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";

type NotificationParams = { id: string };

function toNotification(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: (row.project_id as string | null) ?? null,
    taskId: (row.task_id as string | null) ?? null,
    type: String(row.type),
    title: String(row.title),
    message: String(row.message),
    readAt: (row.read_at as string | null) ?? null,
    createdAt: String(row.created_at),
    projectName: (row.project_name as string | null) ?? null,
    projectKey: (row.project_key as string | null) ?? null,
    taskNumber: row.task_number == null ? null : Number(row.task_number),
  };
}

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", { schema: { tags: ["Notifications"], summary: "List the current user's notifications" } }, async (request) => {
    const rows = db.prepare(`
      SELECT n.*, p.name AS project_name, p.key AS project_key, t.number AS task_number
      FROM notifications n
      LEFT JOIN projects p ON p.id = n.project_id
      LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50
    `).all(request.authUser.id) as Record<string, unknown>[];
    const notifications = rows.map(toNotification);
    return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length };
  });

  app.patch<{ Params: NotificationParams }>("/:id/read", { schema: { tags: ["Notifications"], summary: "Mark a notification as read" } }, async (request, reply) => {
    const result = db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), request.params.id, request.authUser.id);
    if (!result.changes) return reply.code(404).send({ error: "Notification not found" });
    const row = db.prepare(`SELECT n.*, p.name AS project_name, p.key AS project_key, t.number AS task_number
      FROM notifications n LEFT JOIN projects p ON p.id = n.project_id LEFT JOIN tasks t ON t.id = n.task_id
      WHERE n.id = ?`).get(request.params.id) as Record<string, unknown>;
    return { notification: toNotification(row) };
  });

  app.post("/read-all", { schema: { tags: ["Notifications"], summary: "Mark all notifications as read" } }, async (request) => {
    const result = db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
      .run(new Date().toISOString(), request.authUser.id);
    return { updated: result.changes };
  });
}
