import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";

export async function requireProjectAccess(request: FastifyRequest, reply: FastifyReply, projectId: string) {
  if (request.authUser.role === "ADMIN") return true;
  const member = await db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, request.authUser.id);
  if (!member) {
    reply.code(403).send({ error: "You are not a member of this project" });
    return false;
  }
  return true;
}

export async function requireProjectOwnerOrAdmin(request: FastifyRequest, reply: FastifyReply, projectId: string) {
  const project = await db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as { owner_id: string } | undefined;
  if (!project) {
    reply.code(404).send({ error: "Project not found" });
    return false;
  }
  if (request.authUser.role === "ADMIN" || project.owner_id === request.authUser.id) return true;
  reply.code(403).send({ error: "Only the project owner or an administrator can manage members" });
  return false;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser.role !== "ADMIN") {
    reply.code(403).send({ error: "Administrator access required" });
    return false;
  }
  return true;
}
