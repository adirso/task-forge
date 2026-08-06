import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db/database.js";

type AuthRow = {
  id: string;
  name: string;
  email: string | null;
  kind: "HUMAN" | "AGENT";
  role: "ADMIN" | "MEMBER";
};

export function createJwt(user: AuthRow) {
  return jwt.sign({ sub: user.id, kind: user.kind, role: user.role }, config.jwtSecret, { expiresIn: "8h" });
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createApiToken() {
  const prefix = crypto.randomBytes(5).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { token: `tf_${prefix}_${secret}`, prefix };
}

export function installAuth(app: FastifyInstance) {
  app.decorateRequest("authUser", undefined as never);
  app.decorate("authenticate", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const token = header.slice(7);
    let user: AuthRow | undefined;

    if (token.startsWith("tf_")) {
      const row = await db.prepare(`
        SELECT u.id, u.name, u.email, u.kind, u.role, t.id AS token_id
        FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > ?)
      `).get(hashToken(token), new Date().toISOString()) as (AuthRow & { token_id: string }) | undefined;
      if (row) {
        user = row;
        await db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.token_id);
      }
    } else {
      try {
        const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
        user = await db.prepare("SELECT id, name, email, kind, role FROM users WHERE id = ?").get(payload.sub) as AuthRow | undefined;
      } catch {
        user = undefined;
      }
    }

    if (!user) return reply.code(401).send({ error: "Invalid or expired credentials" });
    request.authUser = user;
  });
}
