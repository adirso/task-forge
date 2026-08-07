import type { FastifyInstance } from "fastify";
import { automationCreateSchema, automationUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AutomationApplicationService } from "../application/automation-service.js";
const service = new AutomationApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });
export async function automationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/automations", async (request) => ({ automations: await service.list({ ...context(request), projectId: request.params.projectId }) }));
  app.post<{ Params: { projectId: string } }>("/projects/:projectId/automations", async (request, reply) => reply.code(201).send({ automation: await service.create({ ...context(request), projectId: request.params.projectId }, automationCreateSchema.parse(request.body)) }));
  app.patch<{ Params: { id: string } }>("/automations/:id", async (request) => ({ automation: await service.update(context(request), request.params.id, automationUpdateSchema.parse(request.body)) }));
  app.delete<{ Params: { id: string } }>("/automations/:id", async (request, reply) => { await service.delete(context(request), request.params.id); return reply.code(204).send(); });
}
