import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { agentCreateSchema, profileUpdateSchema, tokenCreateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { requireAdmin } from "../lib/access.js";
import { createApiToken, hashToken } from "../lib/auth.js";
import { toUser } from "../lib/rows.js";

type UserParams = { id: string };
type TokenParams = { id: string };

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", { schema: { tags: ["Users"], summary: "List users and agents" } }, async () => {
    const rows = await db.prepare("SELECT * FROM users ORDER BY kind, name").all() as Record<string, unknown>[];
    return { users: rows.map((row) => toUser(row)) };
  });

  app.patch("/me", { schema: { tags: ["Users"], summary: "Update the current human profile" } }, async (request, reply) => {
    if (request.authUser.kind !== "HUMAN") return reply.code(400).send({ error: "Agent profiles are managed by administrators" });
    const body = profileUpdateSchema.parse(request.body);
    try {
      await db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(body.name, body.email.toLowerCase(), request.authUser.id);
    } catch (error) {
      if (/UNIQUE|Duplicate entry/i.test(String(error))) return reply.code(409).send({ error: "That email address is already in use" });
      throw error;
    }
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(request.authUser.id) as Record<string, unknown>;
    return { user: toUser(row) };
  });

  app.post("/agents", { schema: { tags: ["Agents"], summary: "Create an agent identity" } }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = agentCreateSchema.parse(request.body);
    const id = randomUUID();
    const email = body.email?.toLowerCase() ?? `${id.slice(0, 8)}@agents.taskforge.local`;
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)")
      .run(id, email, body.name, now);
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>;
    return reply.code(201).send({ user: toUser(row) });
  });

  app.post<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "Issue an API token (shown once)" } }, async (request, reply) => {
    if (request.authUser.id !== request.params.id && !requireAdmin(request, reply)) return;
    const body = tokenCreateSchema.parse(request.body);
    const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(request.params.id);
    if (!user) return reply.code(404).send({ error: "User not found" });
    const { token, prefix } = createApiToken();
    const now = new Date();
    const expiresAt = body.expiresInDays === null ? null : new Date(now.getTime() + body.expiresInDays * 86_400_000).toISOString();
    await db.prepare(`INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), request.params.id, body.name, prefix, hashToken(token), expiresAt, now.toISOString());
    return reply.code(201).send({ token, prefix, expiresAt, warning: "Copy this token now; it cannot be shown again." });
  });

  app.get<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "List token metadata" } }, async (request, reply) => {
    if (request.authUser.id !== request.params.id && !requireAdmin(request, reply)) return;
    const tokens = await db.prepare(`SELECT id, name, token_prefix AS prefix, expires_at AS expiresAt,
      last_used_at AS lastUsedAt, revoked_at AS revokedAt, created_at AS createdAt
      FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`).all(request.params.id);
    return { tokens };
  });

  app.delete<{ Params: TokenParams }>("/tokens/:id", { schema: { tags: ["Agents"], summary: "Revoke an API token" } }, async (request, reply) => {
    const token = await db.prepare("SELECT user_id FROM api_tokens WHERE id = ?").get(request.params.id) as { user_id: string } | undefined;
    if (!token) return reply.code(404).send({ error: "Token not found" });
    if (request.authUser.id !== token.user_id && !requireAdmin(request, reply)) return;
    await db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), request.params.id);
    return reply.code(204).send();
  });
}
