import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { taskCreateSchema, taskPrioritySchema, taskStatusSchema, taskTagNameSchema, taskUpdateCreateSchema, taskUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { requireProjectAccess } from "../lib/access.js";
import { toTask } from "../lib/rows.js";

type ProjectParams = { projectId: string };
type TaskParams = { id: string };
type TaskQuery = { status?: string; assigneeId?: string; priority?: string; phaseId?: string; tag?: string; minPoints?: string; maxPoints?: string; q?: string };

const taskSelect = `
  SELECT t.*, u.name AS assignee_name, u.email AS assignee_email,
    u.kind AS assignee_kind, u.role AS assignee_role,
    u.avatar_url AS assignee_avatar_url, u.created_at AS assignee_created_at
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
`;

function recordActivity(projectId: string, taskId: string, actorId: string, action: string, metadata: unknown = {}) {
  db.prepare("INSERT INTO activity (id, project_id, task_id, actor_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), projectId, taskId, actorId, action, JSON.stringify(metadata), new Date().toISOString());
}

function notify(userId: string, projectId: string, taskId: string, type: string, title: string, message: string) {
  db.prepare(`INSERT INTO notifications (id, user_id, project_id, task_id, type, title, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), userId, projectId, taskId, type, title, message, new Date().toISOString());
}

function validateRelation(projectId: string, field: "assignee" | "parent", id: string | null | undefined) {
  if (!id) return true;
  if (field === "assignee") {
    return Boolean(db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, id));
  }
  return Boolean(db.prepare("SELECT 1 FROM tasks WHERE project_id = ? AND id = ?").get(projectId, id));
}

function createsParentCycle(taskId: string, parentId: string | null | undefined) {
  let cursor = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === taskId || visited.has(cursor)) return true;
    visited.add(cursor);
    const row = db.prepare("SELECT parent_id FROM tasks WHERE id = ?").get(cursor) as { parent_id: string | null } | undefined;
    cursor = row?.parent_id ?? null;
  }
  return false;
}

function replaceTaskTags(taskId: string, projectId: string, names: string[], now: string) {
  db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
  const insertTag = db.prepare("INSERT OR IGNORE INTO tags (id, project_id, name, created_at) VALUES (?, ?, ?, ?)");
  const findTag = db.prepare("SELECT id FROM tags WHERE project_id = ? AND name = ? COLLATE NOCASE");
  const attachTag = db.prepare("INSERT INTO task_tags (task_id, tag_id, created_at) VALUES (?, ?, ?)");
  for (const name of names) {
    insertTag.run(randomUUID(), projectId, name, now);
    const tag = findTag.get(projectId, name) as { id: string };
    attachTag.run(taskId, tag.id, now);
  }
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: ProjectParams; Querystring: TaskQuery }>("/projects/:projectId/tasks", { schema: { tags: ["Tasks"], summary: "List project tasks" } }, async (request, reply) => {
    const { projectId } = request.params;
    if (!requireProjectAccess(request, reply, projectId)) return;
    const where = ["t.project_id = ?"];
    const values: unknown[] = [projectId];
    if (request.query.status) {
      const status = taskStatusSchema.parse(request.query.status);
      where.push("t.status = ?"); values.push(status);
    }
    if (request.query.assigneeId) { where.push("t.assignee_id = ?"); values.push(request.query.assigneeId); }
    if (request.query.priority) { where.push("t.priority = ?"); values.push(taskPrioritySchema.parse(request.query.priority)); }
    if (request.query.phaseId) { where.push("t.phase_id = ?"); values.push(request.query.phaseId); }
    if (request.query.tag) {
      const parsedTag = taskTagNameSchema.safeParse(request.query.tag);
      if (!parsedTag.success) return reply.code(400).send({ error: "Validation failed", issues: parsedTag.error.issues });
      where.push("EXISTS (SELECT 1 FROM task_tags tt JOIN tags tag ON tag.id = tt.tag_id WHERE tt.task_id = t.id AND tag.name = ? COLLATE NOCASE)");
      values.push(parsedTag.data);
    }
    if (request.query.minPoints !== undefined) { where.push("t.estimate_points >= ?"); values.push(Number(request.query.minPoints)); }
    if (request.query.maxPoints !== undefined) { where.push("t.estimate_points <= ?"); values.push(Number(request.query.maxPoints)); }
    if (request.query.q) {
      where.push("(t.title LIKE ? OR t.description LIKE ?)");
      values.push(`%${request.query.q}%`, `%${request.query.q}%`);
    }
    const rows = db.prepare(`${taskSelect} WHERE ${where.join(" AND ")} ORDER BY t.status, t.position, t.created_at DESC`).all(...values) as Record<string, unknown>[];
    return { tasks: rows.map(toTask) };
  });

  app.post<{ Params: ProjectParams }>("/projects/:projectId/tasks", { schema: { tags: ["Tasks"], summary: "Create a task" } }, async (request, reply) => {
    const { projectId } = request.params;
    if (!requireProjectAccess(request, reply, projectId)) return;
    const parsedBody = taskCreateSchema.safeParse(request.body);
    if (!parsedBody.success) return reply.code(400).send({ error: "Validation failed", issues: parsedBody.error.issues });
    const body = parsedBody.data;
    if (!validateRelation(projectId, "assignee", body.assigneeId)) return reply.code(400).send({ error: "Assignee is not a project member" });
    if (!validateRelation(projectId, "parent", body.parentId)) return reply.code(400).send({ error: "Parent task is not in this project" });
    const phaseId = body.phaseId === undefined
      ? (db.prepare("SELECT id FROM phases WHERE project_id = ? AND is_active = 1").get(projectId) as { id: string } | undefined)?.id ?? null
      : body.phaseId;
    if (phaseId && !db.prepare("SELECT 1 FROM phases WHERE id = ? AND project_id = ?").get(phaseId, projectId)) return reply.code(400).send({ error: "Phase is not in this project" });
    const id = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      const project = db.prepare("SELECT next_task_number FROM projects WHERE id = ?").get(projectId) as { next_task_number: number } | undefined;
      if (!project) throw new Error("PROJECT_NOT_FOUND");
      const position = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tasks WHERE project_id = ? AND status = ?").get(projectId, body.status) as { next: number }).next;
      db.prepare(`INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority,
        assignee_id, creator_id, parent_id, branch, due_date, estimate_points, pull_request_url, pull_request_title,
        pull_request_state, phase_id, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, projectId, project.next_task_number, body.title, body.description, body.definitionOfDone, body.status, body.priority,
          body.assigneeId ?? null, request.authUser.id, body.parentId ?? null, body.branch ?? null, body.dueDate ?? null,
          body.estimatePoints ?? null, body.pullRequestUrl ?? null, body.pullRequestTitle ?? null,
          body.pullRequestUrl ? body.pullRequestState ?? "OPEN" : null, phaseId, position, now, now);
      db.prepare("UPDATE projects SET next_task_number = next_task_number + 1, updated_at = ? WHERE id = ?").run(now, projectId);
      replaceTaskTags(id, projectId, body.tags ?? [], now);
      recordActivity(projectId, id, request.authUser.id, "task.created", { title: body.title });
      if (body.assigneeId && body.assigneeId !== request.authUser.id) {
        notify(body.assigneeId, projectId, id, "TASK_ASSIGNED", "Task assigned to you", `${request.authUser.name} assigned you “${body.title}”.`);
      }
    })();
    const row = db.prepare(`${taskSelect} WHERE t.id = ?`).get(id) as Record<string, unknown>;
    return reply.code(201).send({ task: toTask(row) });
  });

  app.get<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Get a task" } }, async (request, reply) => {
    const row = db.prepare(`${taskSelect} WHERE t.id = ?`).get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Task not found" });
    if (!requireProjectAccess(request, reply, String(row.project_id))) return;
    return { task: toTask(row) };
  });

  app.patch<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Update a task" } }, async (request, reply) => {
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!existing) return reply.code(404).send({ error: "Task not found" });
    const projectId = String(existing.project_id);
    if (!requireProjectAccess(request, reply, projectId)) return;
    const parsedBody = taskUpdateSchema.safeParse(request.body);
    if (!parsedBody.success) return reply.code(400).send({ error: "Validation failed", issues: parsedBody.error.issues });
    const body = parsedBody.data;
    if (!validateRelation(projectId, "assignee", body.assigneeId)) return reply.code(400).send({ error: "Assignee is not a project member" });
    if (!validateRelation(projectId, "parent", body.parentId)) return reply.code(400).send({ error: "Parent task is not in this project" });
    if (body.phaseId && !db.prepare("SELECT 1 FROM phases WHERE id = ? AND project_id = ?").get(body.phaseId, projectId)) return reply.code(400).send({ error: "Phase is not in this project" });
    if (body.parentId !== undefined && createsParentCycle(request.params.id, body.parentId)) return reply.code(400).send({ error: "Parent relationship would create a cycle" });

    const columns: Record<string, string> = {
      title: "title", description: "description", definitionOfDone: "definition_of_done", status: "status",
      priority: "priority", assigneeId: "assignee_id", parentId: "parent_id", branch: "branch",
      dueDate: "due_date", estimatePoints: "estimate_points", pullRequestUrl: "pull_request_url",
      pullRequestTitle: "pull_request_title", pullRequestState: "pull_request_state", position: "position",
      phaseId: "phase_id",
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (key in body) { fields.push(`${column} = ?`); values.push(body[key as keyof typeof body] ?? null); }
    }
    if (fields.length || body.tags !== undefined) {
      const now = new Date().toISOString();
      if (fields.length) { fields.push("updated_at = ?"); values.push(now, request.params.id); }
      db.transaction(() => {
        if (fields.length) db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
        else db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, request.params.id);
        if (body.tags !== undefined) replaceTaskTags(request.params.id, projectId, body.tags, now);
        db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
        recordActivity(projectId, request.params.id, request.authUser.id, "task.updated", body);
        const taskTitle = body.title ?? String(existing.title);
        if (body.assigneeId && body.assigneeId !== existing.assignee_id && body.assigneeId !== request.authUser.id) {
          notify(body.assigneeId, projectId, request.params.id, "TASK_ASSIGNED", "Task assigned to you", `${request.authUser.name} assigned you “${taskTitle}”.`);
        }
        if (body.status === "IN_REVIEW" && existing.status !== "IN_REVIEW" && existing.creator_id !== request.authUser.id) {
          notify(String(existing.creator_id), projectId, request.params.id, "REVIEW_REQUESTED", "Review requested", `${request.authUser.name} moved “${taskTitle}” to review.`);
        }
      })();
    }
    const row = db.prepare(`${taskSelect} WHERE t.id = ?`).get(request.params.id) as Record<string, unknown>;
    return { task: toTask(row) };
  });

  app.get<{ Params: ProjectParams }>("/projects/:projectId/tags", { schema: { tags: ["Tasks"], summary: "List reusable project tags" } }, async (request, reply) => {
    const { projectId } = request.params;
    if (!requireProjectAccess(request, reply, projectId)) return;
    const tags = db.prepare(`SELECT tags.*, COUNT(task_tags.task_id) AS task_count FROM tags
      LEFT JOIN task_tags ON task_tags.tag_id = tags.id WHERE tags.project_id = ?
      GROUP BY tags.id ORDER BY tags.name`).all(projectId) as Record<string, unknown>[];
    return { tags: tags.map((tag) => ({ id: String(tag.id), projectId: String(tag.project_id), name: String(tag.name), createdAt: String(tag.created_at), taskCount: Number(tag.task_count) })) };
  });

  app.get<{ Params: TaskParams }>("/tasks/:id/updates", { schema: { tags: ["Task updates"], summary: "List notes and updates on a task" } }, async (request, reply) => {
    const task = db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(request.params.id) as { project_id: string } | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });
    if (!requireProjectAccess(request, reply, task.project_id)) return;
    const rows = db.prepare(`
      SELECT tu.*, u.id AS author_user_id, u.email AS author_email, u.name AS author_name,
        u.kind AS author_kind, u.role AS author_role, u.avatar_url AS author_avatar_url,
        u.created_at AS author_created_at
      FROM task_updates tu JOIN users u ON u.id = tu.author_id
      WHERE tu.task_id = ? ORDER BY tu.created_at DESC
    `).all(request.params.id) as Record<string, unknown>[];
    return { updates: rows.map((row) => ({
      id: String(row.id), taskId: String(row.task_id), authorId: String(row.author_id), body: String(row.body),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      author: { id: String(row.author_user_id), email: (row.author_email as string | null) ?? null, name: String(row.author_name),
        kind: row.author_kind, role: row.author_role, avatarUrl: (row.author_avatar_url as string | null) ?? null,
        createdAt: String(row.author_created_at) },
    })) };
  });

  app.post<{ Params: TaskParams }>("/tasks/:id/updates", { schema: { tags: ["Task updates"], summary: "Post a note or progress update" } }, async (request, reply) => {
    const task = db.prepare("SELECT project_id, title, creator_id, assignee_id FROM tasks WHERE id = ?").get(request.params.id) as { project_id: string; title: string; creator_id: string; assignee_id: string | null } | undefined;
    if (!task) return reply.code(404).send({ error: "Task not found" });
    if (!requireProjectAccess(request, reply, task.project_id)) return;
    const body = taskUpdateCreateSchema.parse(request.body);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, request.params.id, request.authUser.id, body.body, now, now);
      recordActivity(task.project_id, request.params.id, request.authUser.id, "task.note_added");
      const recipients = new Set([task.creator_id, task.assignee_id].filter((userId): userId is string => Boolean(userId && userId !== request.authUser.id)));
      for (const recipientId of recipients) notify(recipientId, task.project_id, request.params.id, "TASK_UPDATED", "New task update", `${request.authUser.name} posted an update on “${task.title}”.`);
    })();
    const row = db.prepare(`SELECT tu.*, u.id AS author_user_id, u.email AS author_email, u.name AS author_name,
      u.kind AS author_kind, u.role AS author_role, u.avatar_url AS author_avatar_url, u.created_at AS author_created_at
      FROM task_updates tu JOIN users u ON u.id = tu.author_id WHERE tu.id = ?`).get(id) as Record<string, unknown>;
    return reply.code(201).send({ update: {
      id: String(row.id), taskId: String(row.task_id), authorId: String(row.author_id), body: String(row.body),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      author: { id: String(row.author_user_id), email: (row.author_email as string | null) ?? null, name: String(row.author_name),
        kind: row.author_kind, role: row.author_role, avatarUrl: (row.author_avatar_url as string | null) ?? null,
        createdAt: String(row.author_created_at) },
    } });
  });

  app.delete<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Delete a task and its subtasks" } }, async (request, reply) => {
    const existing = db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(request.params.id) as { project_id: string } | undefined;
    if (!existing) return reply.code(404).send({ error: "Task not found" });
    if (!requireProjectAccess(request, reply, existing.project_id)) return;
    db.prepare("DELETE FROM tasks WHERE id = ?").run(request.params.id);
    return reply.code(204).send();
  });
}
