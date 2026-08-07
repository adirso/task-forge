import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { ZodError } from "zod";
import { ApplicationError } from "./application/errors.js";
import { config } from "./config.js";
import "./db/database.js";
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

export async function buildApp() {
  const app = Fastify({ logger: !process.env.TEST });
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(swagger, {
    openapi: {
      info: { title: "TaskForge API", description: "Project and task management API for humans and agents", version: "0.1.0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  installAuth(app);

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

  app.setErrorHandler((error, _request, reply) => {
    const applicationStatuses = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400, INTERNAL: 500 } as const;
    if (error instanceof ApplicationError || (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && error.code in applicationStatuses)) {
      const code = (error as { code: keyof typeof applicationStatuses }).code;
      const message = error instanceof Error ? error.message : "Request failed";
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

  return app;
}
