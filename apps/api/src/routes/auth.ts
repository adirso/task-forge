import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { loginSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AuthApplicationService } from "../application/auth-service.js";
import { createJwt } from "../lib/auth.js";
import { rateLimited, RateLimiter } from "../lib/rate-limit.js";
import { config } from "../config.js";
import { recordSecurityAudit } from "../lib/security-audit.js";

const service = new AuthApplicationService(createUnitOfWork(db), { compare: bcrypt.compare }, { issue: createJwt });
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });

export async function authRoutes(app: FastifyInstance) {
  const limiter = app.securityRateLimiter;
  const loginLimiter = new RateLimiter(config.rateLimitWindowMs, config.loginRateLimitIp, config.rateLimitMaxBackoffMs);
  const accountLimiter = new RateLimiter(config.rateLimitWindowMs, config.loginRateLimitAccount, config.rateLimitMaxBackoffMs);
  app.post("/login", { schema: { tags: ["Auth"], summary: "Sign in as a human user" } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const ipKey = `login:ip:${request.ip}`;
    const accountKey = `login:account:${body.email.trim().toLowerCase()}`;
    if (rateLimited(reply, loginLimiter.check(ipKey)) || rateLimited(reply, accountLimiter.check(accountKey))) { await recordSecurityAudit({ action: "login", outcome: "throttled", ip: request.ip, account: body.email.trim().toLowerCase() }); return; }
    try {
      const result = await service.authenticate(body);
      loginLimiter.success(ipKey); accountLimiter.success(accountKey);
      await recordSecurityAudit({ action: "login", outcome: "success", ip: request.ip, account: body.email.trim().toLowerCase(), userId: result.user.id });
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid email or password") {
        loginLimiter.failure(ipKey); accountLimiter.failure(accountKey);
        await recordSecurityAudit({ action: "login", outcome: "failure", ip: request.ip, account: body.email.trim().toLowerCase() });
        return reply.code(401).send({ error: "Invalid email or password" });
      }
      throw error;
    }
  });
  app.get("/me", { preHandler: app.authenticate, schema: { tags: ["Auth"], summary: "Get the authenticated user" } }, async (request) => ({ user: await service.currentUser(context(request)) }));
}
