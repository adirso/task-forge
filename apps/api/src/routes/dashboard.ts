import type { FastifyInstance } from "fastify";
import { TASK_STATUSES } from "@taskforge/contracts";
import { db } from "../db/database.js";

const STUCK_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

type ProjectRow = { id: string; name: string; key: string; color: string };
type CountRow = { project_id: string; status: string; cnt: number };
type TaskRow = { id: string; number: number; title: string; project_id: string; status: string; updated_at: string; project_key: string; project_name: string; assignee_name: string | null };

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/summary", { schema: { tags: ["Dashboard"], summary: "Dashboard summary for home screen widgets" } }, async (request) => {
    const { authUser } = request;

    // Projects the user is a member of (or all for admins)
    const projectRows = authUser.role === "ADMIN"
      ? await db.prepare("SELECT id, name, key, color FROM projects ORDER BY name ASC").all() as ProjectRow[]
      : await db.prepare(`
          SELECT p.id, p.name, p.key, p.color
          FROM projects p
          JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
          ORDER BY p.name ASC
        `).all(authUser.id) as ProjectRow[];

    const projectIds = projectRows.map((p) => p.id);

    // Task counts per project per status
    const counts: Record<string, Record<string, number>> = {};
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => "?").join(",");
      const countRows = await db.prepare(`
        SELECT project_id, status, COUNT(*) as cnt
        FROM tasks
        WHERE project_id IN (${placeholders})
        GROUP BY project_id, status
      `).all(...projectIds) as CountRow[];
      for (const row of countRows) {
        if (!counts[row.project_id]) counts[row.project_id] = {};
        (counts[row.project_id] as Record<string, number>)[row.status] = row.cnt;
      }
    }

    const projects = projectRows.map((p) => {
      const c = counts[p.id] ?? {};
      const statusCounts = Object.fromEntries(TASK_STATUSES.map((status) => [status, c[status] ?? 0]));
      return {
        id: p.id,
        name: p.name,
        key: p.key,
        color: p.color,
        counts: { ...statusCounts, total: TASK_STATUSES.reduce((total, status) => total + (c[status] ?? 0), 0) },
      };
    });

    // My open tasks (non-done, non-backlog)
    const myTaskRows = await db.prepare(`
      SELECT t.id, t.number, t.title, t.project_id, t.status, t.updated_at,
             p.key as project_key, p.name as project_name,
             u.name as assignee_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      JOIN users u ON u.id = t.assignee_id
      WHERE t.assignee_id = ? AND t.status NOT IN ('DONE','CANCELLED','BACKLOG')
      ORDER BY t.updated_at DESC
      LIMIT 30
    `).all(authUser.id) as TaskRow[];

    const myTasks = myTaskRows.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      projectId: t.project_id,
      projectKey: t.project_key,
      projectName: t.project_name,
      status: t.status,
      assigneeName: t.assignee_name,
      updatedAt: t.updated_at,
    }));

    // Stuck tasks (IN_PROGRESS, not updated in 4h) across member projects
    let stuckTasks: typeof myTasks = [];
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => "?").join(",");
      const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
      const rows = await db.prepare(`
        SELECT t.id, t.number, t.title, t.project_id, t.status, t.updated_at,
               p.key as project_key, p.name as project_name,
               u.name as assignee_name
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id IN (${placeholders})
          AND t.status = 'IN_PROGRESS'
          AND t.updated_at < ?
        ORDER BY t.updated_at ASC
        LIMIT 20
      `).all(...projectIds, cutoff) as TaskRow[];

      stuckTasks = rows.map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        projectId: t.project_id,
        projectKey: t.project_key,
        projectName: t.project_name,
        status: t.status,
        assigneeName: t.assignee_name,
        updatedAt: t.updated_at,
      }));
    }

    return { projects, myTasks, stuckTasks };
  });
}
