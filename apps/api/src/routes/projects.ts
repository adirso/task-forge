import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { memberAddSchema, projectCreateSchema, projectUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { requireProjectAccess, requireProjectOwnerOrAdmin } from "../lib/access.js";
import { toProject, toUser } from "../lib/rows.js";

type ProjectParams = { id: string };

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", { schema: { tags: ["Projects"], summary: "List accessible projects" } }, async (request) => {
    const rows = db.prepare(`
      SELECT p.*, COUNT(t.id) AS task_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE ? = 'ADMIN' OR EXISTS (
        SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?
      )
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all(request.authUser.role, request.authUser.id) as Record<string, unknown>[];
    return { projects: rows.map(toProject) };
  });

  app.post("/", { schema: { tags: ["Projects"], summary: "Create a project" } }, async (request, reply) => {
    const body = projectCreateSchema.parse(request.body);
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO projects (id, key, name, description, repo_url, color, owner_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, body.key, body.name, body.description, body.repoUrl ?? null, body.color, request.authUser.id, now, now);
        db.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)")
          .run(id, request.authUser.id, now);
        db.prepare("INSERT INTO phases (id, project_id, number, goal, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, 1, ?, ?)")
          .run(randomUUID(), id, "Plan and deliver the first project milestone.", now, now);
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return reply.code(409).send({ error: "Project key already exists" });
      throw error;
    }
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>;
    return reply.code(201).send({ project: toProject(row) });
  });

  app.get<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Get a project" } }, async (request, reply) => {
    if (!requireProjectAccess(request, reply, request.params.id)) return;
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Project not found" });
    const memberRows = db.prepare(`
      SELECT u.*, pm.role AS project_role FROM users u JOIN project_members pm ON pm.user_id = u.id
      WHERE pm.project_id = ? ORDER BY u.kind, u.name
    `).all(request.params.id) as Record<string, unknown>[];
    return { project: { ...toProject(row), members: memberRows.map((member) => ({ ...toUser(member), projectRole: String(member.project_role) })) } };
  });

  app.patch<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Update a project" } }, async (request, reply) => {
    if (!requireProjectAccess(request, reply, request.params.id)) return;
    const body = projectUpdateSchema.parse(request.body);
    const fields: string[] = [];
    const values: unknown[] = [];
    const mapping: Record<string, string> = { name: "name", description: "description", repoUrl: "repo_url", color: "color" };
    for (const [key, column] of Object.entries(mapping)) {
      if (key in body) { fields.push(`${column} = ?`); values.push(body[key as keyof typeof body] ?? null); }
    }
    if (fields.length) {
      fields.push("updated_at = ?"); values.push(new Date().toISOString(), request.params.id);
      db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Project not found" });
    return { project: toProject(row) };
  });

  app.post<{ Params: ProjectParams }>("/:id/members", { schema: { tags: ["Projects"], summary: "Add a project member" } }, async (request, reply) => {
    if (!requireProjectOwnerOrAdmin(request, reply, request.params.id)) return;
    const body = memberAddSchema.parse(request.body);
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(body.userId);
    if (!user) return reply.code(404).send({ error: "User not found" });
    const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(request.params.id) as { owner_id: string };
    if (body.role === "OWNER" && body.userId !== project.owner_id) return reply.code(400).send({ error: "A project can only have its original owner" });
    const memberRole = body.userId === project.owner_id ? "OWNER" : body.role;
    db.prepare(`INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`)
      .run(request.params.id, body.userId, memberRole, new Date().toISOString());
    return reply.code(204).send();
  });

  app.delete<{ Params: ProjectParams & { userId: string } }>("/:id/members/:userId", { schema: { tags: ["Projects"], summary: "Remove a project member" } }, async (request, reply) => {
    if (!requireProjectOwnerOrAdmin(request, reply, request.params.id)) return;
    const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(request.params.id) as { owner_id: string };
    if (request.params.userId === project.owner_id) return reply.code(400).send({ error: "The project owner cannot be removed" });
    const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(request.params.id, request.params.userId);
    if (!member) return reply.code(404).send({ error: "Project member not found" });
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE project_id = ? AND assignee_id = ?").run(now, request.params.id, request.params.userId);
      db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(request.params.id, request.params.userId);
    })();
    return reply.code(204).send();
  });

  app.delete<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Delete a project and all of its data" } }, async (request, reply) => {
    const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(request.params.id) as { owner_id: string } | undefined;
    if (!project) return reply.code(404).send({ error: "Project not found" });
    if (request.authUser.role !== "ADMIN" && project.owner_id !== request.authUser.id) {
      return reply.code(403).send({ error: "Only the project owner or an administrator can delete this project" });
    }
    db.prepare("DELETE FROM projects WHERE id = ?").run(request.params.id);
    return reply.code(204).send();
  });
}
