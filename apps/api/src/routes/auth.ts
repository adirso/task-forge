import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { loginSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AuthApplicationService } from "../application/auth-service.js";
import { createJwt } from "../lib/auth.js";

const service = new AuthApplicationService(createUnitOfWork(db), { compare: bcrypt.compare }, { issue: createJwt });
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", { schema: { tags: ["Auth"], summary: "Sign in as a human user" } }, async (_request, reply) => {
    const body = loginSchema.parse(_request.body);
    try { return await service.authenticate(body); } catch (error) { if (error instanceof Error && error.message === "Invalid email or password") return reply.code(401).send({ error: error.message }); throw error; }
  });
  app.get("/me", { preHandler: app.authenticate, schema: { tags: ["Auth"], summary: "Get the authenticated user" } }, async (request) => ({ user: await service.currentUser(context(request)) }));
}
