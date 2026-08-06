import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/database.js";

export function requireProjectAccess(request: FastifyRequest, reply: FastifyReply, projectId: string) {
  if (request.authUser.role === "ADMIN") return true;
  const member = db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, request.authUser.id);
  if (!member) {
    reply.code(403).send({ error: "You are not a member of this project" });
    return false;
  }
  return true;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser.role !== "ADMIN") {
    reply.code(403).send({ error: "Administrator access required" });
    return false;
  }
  return true;
}
