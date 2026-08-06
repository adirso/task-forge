import type { FastifyInstance } from "fastify";
import { db } from "../db/database.js";
import { requireProjectAccess } from "../lib/access.js";
import { toProject, toTask } from "../lib/rows.js";

type ContextQuery = { project?: string; task?: string };

const contextTaskSelect = `
  SELECT t.*, u.name AS assignee_name, u.email AS assignee_email,
    u.kind AS assignee_kind, u.role AS assignee_role,
    u.avatar_url AS assignee_avatar_url, u.created_at AS assignee_created_at
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
`;

export async function contextRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Querystring: ContextQuery }>("/", { schema: { tags: ["Context"], summary: "Resolve shareable project and task query parameters" } }, async (request, reply) => {
    const projectRef = request.query.project?.trim();
    const taskRef = request.query.task?.trim();
    if (!projectRef && !taskRef) return reply.code(400).send({ error: "Provide a project or task query parameter" });

    let taskRow: Record<string, unknown> | undefined;
    if (taskRef) {
      if (/^[0-9a-f-]{36}$/i.test(taskRef)) {
        taskRow = db.prepare(`${contextTaskSelect} WHERE t.id = ?`).get(taskRef) as Record<string, unknown> | undefined;
      } else {
        const match = taskRef.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
        if (!match) return reply.code(400).send({ error: "Task must be a UUID or a key such as TF-42" });
        taskRow = db.prepare(`${contextTaskSelect} JOIN projects task_project ON task_project.id = t.project_id
          WHERE task_project.key = ? COLLATE NOCASE AND t.number = ?`).get(match[1], Number(match[2])) as Record<string, unknown> | undefined;
      }
      if (!taskRow) return reply.code(404).send({ error: "Task not found" });
    }

    let projectRow: Record<string, unknown> | undefined;
    if (projectRef) {
      projectRow = db.prepare("SELECT * FROM projects WHERE id = ? OR key = ? COLLATE NOCASE").get(projectRef, projectRef) as Record<string, unknown> | undefined;
      if (!projectRow) return reply.code(404).send({ error: "Project not found" });
    } else if (taskRow) {
      projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(taskRow.project_id) as Record<string, unknown> | undefined;
    }

    if (!projectRow) return reply.code(404).send({ error: "Project not found" });
    if (taskRow && String(taskRow.project_id) !== String(projectRow.id)) return reply.code(400).send({ error: "The task does not belong to the requested project" });
    if (!requireProjectAccess(request, reply, String(projectRow.id))) return;
    return { project: toProject(projectRow), task: taskRow ? toTask(taskRow) : null };
  });
}
