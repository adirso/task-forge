import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { phaseCreateSchema, phaseUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { requireProjectAccess } from "../lib/access.js";

type ProjectParams = { projectId: string };
type PhaseParams = { id: string };

function toPhase(row: Record<string, unknown>) {
  return {
    id: String(row.id), projectId: String(row.project_id), number: Number(row.number), goal: String(row.goal),
    isActive: Boolean(row.is_active), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}),
  };
}

export async function phaseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get<{ Params: ProjectParams }>("/projects/:projectId/phases", { schema: { tags: ["Phases"], summary: "List project phases" } }, async (request, reply) => {
    if (!requireProjectAccess(request, reply, request.params.projectId)) return;
    const rows = db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM phases p LEFT JOIN tasks t ON t.phase_id = p.id
      WHERE p.project_id = ? GROUP BY p.id ORDER BY p.number DESC`).all(request.params.projectId) as Record<string, unknown>[];
    return { phases: rows.map(toPhase) };
  });

  app.post<{ Params: ProjectParams }>("/projects/:projectId/phases", { schema: { tags: ["Phases"], summary: "Create a project phase" } }, async (request, reply) => {
    const { projectId } = request.params;
    if (!requireProjectAccess(request, reply, projectId)) return;
    const body = phaseCreateSchema.parse(request.body);
    const id = randomUUID(); const now = new Date().toISOString();
    try {
      db.transaction(() => {
        if (body.isActive) db.prepare("UPDATE phases SET is_active = 0, updated_at = ? WHERE project_id = ?").run(now, projectId);
        db.prepare("INSERT INTO phases (id, project_id, number, goal, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(id, projectId, body.number, body.goal, body.isActive ? 1 : 0, now, now);
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return reply.code(409).send({ error: "That phase number already exists" });
      throw error;
    }
    const row = db.prepare("SELECT *, 0 AS task_count FROM phases WHERE id = ?").get(id) as Record<string, unknown>;
    return reply.code(201).send({ phase: toPhase(row) });
  });

  app.patch<{ Params: PhaseParams }>("/phases/:id", { schema: { tags: ["Phases"], summary: "Update or activate a phase" } }, async (request, reply) => {
    const existing = db.prepare("SELECT * FROM phases WHERE id = ?").get(request.params.id) as Record<string, unknown> | undefined;
    if (!existing) return reply.code(404).send({ error: "Phase not found" });
    const projectId = String(existing.project_id);
    if (!requireProjectAccess(request, reply, projectId)) return;
    const body = phaseUpdateSchema.parse(request.body);
    const fields: string[] = []; const values: unknown[] = [];
    if (body.number !== undefined) { fields.push("number = ?"); values.push(body.number); }
    if (body.goal !== undefined) { fields.push("goal = ?"); values.push(body.goal); }
    if (body.isActive !== undefined) { fields.push("is_active = ?"); values.push(body.isActive ? 1 : 0); }
    const now = new Date().toISOString();
    try {
      db.transaction(() => {
        if (body.isActive) db.prepare("UPDATE phases SET is_active = 0, updated_at = ? WHERE project_id = ? AND id != ?").run(now, projectId, request.params.id);
        if (fields.length) { fields.push("updated_at = ?"); values.push(now, request.params.id); db.prepare(`UPDATE phases SET ${fields.join(", ")} WHERE id = ?`).run(...values); }
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return reply.code(409).send({ error: "That phase number already exists" });
      throw error;
    }
    const row = db.prepare("SELECT p.*, COUNT(t.id) AS task_count FROM phases p LEFT JOIN tasks t ON t.phase_id = p.id WHERE p.id = ? GROUP BY p.id").get(request.params.id) as Record<string, unknown>;
    return { phase: toPhase(row) };
  });

  app.delete<{ Params: PhaseParams }>("/phases/:id", { schema: { tags: ["Phases"], summary: "Delete a phase and unassign its tasks" } }, async (request, reply) => {
    const existing = db.prepare("SELECT project_id FROM phases WHERE id = ?").get(request.params.id) as { project_id: string } | undefined;
    if (!existing) return reply.code(404).send({ error: "Phase not found" });
    if (!requireProjectAccess(request, reply, existing.project_id)) return;
    db.transaction(() => { db.prepare("UPDATE tasks SET phase_id = NULL WHERE phase_id = ?").run(request.params.id); db.prepare("DELETE FROM phases WHERE id = ?").run(request.params.id); })();
    return reply.code(204).send();
  });
}
