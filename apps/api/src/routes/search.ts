import type { FastifyInstance } from "fastify";
import type { TaskSearchResult } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { toTask } from "../lib/rows.js";

type SearchQuery = { q?: string };

export async function searchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Querystring: SearchQuery }>("/", { schema: { tags: ["Search"], summary: "Search accessible tasks across projects" } }, async (request) => {
    const query = request.query.q?.trim();
    if (!query) return { results: [] };
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db.prepare(`
      SELECT t.*, u.name AS assignee_name, u.email AS assignee_email,
        u.kind AS assignee_kind, u.role AS assignee_role,
        u.avatar_url AS assignee_avatar_url, u.created_at AS assignee_created_at,
        p.name AS project_name, p.key AS project_key, p.color AS project_color
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE (? = 'ADMIN' OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?
      )) AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\'
        OR t.definition_of_done LIKE ? ESCAPE '\\' OR (p.key || '-' || t.number) LIKE ? ESCAPE '\\')
      ORDER BY CASE WHEN t.title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, t.updated_at DESC
      LIMIT 40
    `).all(request.authUser.role, request.authUser.id, pattern, pattern, pattern, pattern, pattern) as Record<string, unknown>[];
    const results: TaskSearchResult[] = rows.map((row) => ({
      ...toTask(row),
      projectName: String(row.project_name),
      projectKey: String(row.project_key),
      projectColor: String(row.project_color),
    }));
    return { results };
  });
}
