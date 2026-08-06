import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { loginSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createJwt } from "../lib/auth.js";
import { toUser } from "../lib/rows.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", { schema: { tags: ["Auth"], summary: "Sign in as a human user" } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const row = db.prepare("SELECT * FROM users WHERE email = ? AND kind = 'HUMAN'").get(body.email.toLowerCase()) as Record<string, unknown> | undefined;
    if (!row?.password_hash || !(await bcrypt.compare(body.password, String(row.password_hash)))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const user = toUser(row);
    return { token: createJwt(user), user };
  });

  app.get("/me", { preHandler: app.authenticate, schema: { tags: ["Auth"], summary: "Get the authenticated user" } }, async (request) => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(request.authUser.id) as Record<string, unknown>;
    return { user: toUser(row) };
  });
}
