import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { ZodError } from "zod";
import { ApplicationError } from "./application/errors.js";
import { config } from "./config.js";
import { db } from "./db/database.js";
import { createUnitOfWork } from "./infrastructure/database.js";
import { decryptSecret } from "./lib/token-crypto.js";
import { WebhookDispatcher } from "./lib/webhook.js";
import { installAuth } from "./lib/auth.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";
import { notificationRoutes } from "./routes/notifications.js";
import { searchRoutes } from "./routes/search.js";
import { contextRoutes } from "./routes/context.js";
import { phaseRoutes } from "./routes/phases.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { automationRoutes } from "./routes/automations.js";
import { activityRoutes } from "./routes/activity.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { expireAgentRuns, runRoutes } from "./routes/runs.js";
import { RateLimiter } from "./lib/rate-limit.js";

export async function buildApp(options: { startWebhookDispatcher?: boolean } = {}) {
  const app = Fastify({ logger: !process.env.TEST, trustProxy: config.trustedProxy });
  app.decorate("securityRateLimiter", new RateLimiter(config.rateLimitWindowMs, config.sensitiveRateLimit, config.rateLimitMaxBackoffMs));
  const webhookDispatcher = new WebhookDispatcher(createUnitOfWork(db), (ciphertext) => decryptSecret(ciphertext, config.tokenEncryptionKey), {
    logger: {
      info: (details, message) => app.log.info(details, message),
      warn: (details, message) => app.log.warn(details, message),
    },
  });
  let runReaper: ReturnType<typeof setInterval> | null = null;
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(swagger, {
    openapi: {
      info: { title: "TaskForge API", description: "Project and task management API for humans and agents", version: "0.1.0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  installAuth(app);
  if (options.startWebhookDispatcher ?? !process.env.TEST) {
    app.addHook("onReady", async () => webhookDispatcher.start());
    app.addHook("onClose", async () => webhookDispatcher.stop());
  }
  if (!process.env.TEST) {
    app.addHook("onReady", async () => {
      runReaper = setInterval(() => void expireAgentRuns().catch((error) => app.log.warn({ error }, "agent run expiry sweep failed")), 30_000);
    });
    app.addHook("onClose", async () => { if (runReaper) clearInterval(runReaper); runReaper = null; });
  }

  app.setErrorHandler((error, _request, reply) => {
    const applicationStatuses = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400, INTERNAL: 500 } as const;
    if (error instanceof ApplicationError || (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code in applicationStatuses)) {
      const code = (error as { code: keyof typeof applicationStatuses }).code;
      const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "Request failed";
      const issues = error instanceof ApplicationError ? error.issues : undefined;
      return reply.code(applicationStatuses[code]).send({ error: message, ...(issues ? { issues } : {}) });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    if (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
      const message = "message" in error && typeof error.message === "string" ? error.message : "Request failed";
      return reply.code(error.statusCode).send({ error: message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", { schema: { tags: ["System"], summary: "Health check" } }, async () => ({ status: "ok" }));
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(projectRoutes, { prefix: "/api/projects" });
  await app.register(taskRoutes, { prefix: "/api" });
  await app.register(userRoutes, { prefix: "/api/users" });
  await app.register(notificationRoutes, { prefix: "/api/notifications" });
  await app.register(searchRoutes, { prefix: "/api/search" });
  await app.register(contextRoutes, { prefix: "/api/context" });
  await app.register(phaseRoutes, { prefix: "/api" });
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(automationRoutes, { prefix: "/api" });
  await app.register(activityRoutes, { prefix: "/api/activity" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(runRoutes, { prefix: "/api" });

  return app;
}
