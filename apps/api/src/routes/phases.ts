import type { FastifyInstance } from "fastify";
import { phaseCreateSchema, phaseDeleteSchema, phaseUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { PhaseApplicationService } from "../application/resource-services.js";

type ProjectParams = { projectId: string };
type PhaseParams = { id: string };
const service = new PhaseApplicationService(createUnitOfWork(db));
const requestContext = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });
const projectContext = (request: Parameters<typeof requestContext>[0], projectId: string) => ({ ...requestContext(request), projectId });

export async function phaseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: ProjectParams }>("/projects/:projectId/phases", { schema: { tags: ["Phases"], summary: "List project phases" } }, async (request) => ({ phases: await service.list(projectContext(request, request.params.projectId)) }));
  app.post<{ Params: ProjectParams }>("/projects/:projectId/phases", { schema: { tags: ["Phases"], summary: "Create a project phase" } }, async (request, reply) => reply.code(201).send({ phase: await service.create(projectContext(request, request.params.projectId), phaseCreateSchema.parse(request.body)) }));
  app.patch<{ Params: PhaseParams }>("/phases/:id", { schema: { tags: ["Phases"], summary: "Update or activate a phase" } }, async (request) => ({ phase: await service.update(requestContext(request), request.params.id, phaseUpdateSchema.parse(request.body)) }));
  app.delete<{ Params: PhaseParams }>("/phases/:id", { schema: { tags: ["Phases"], summary: "Delete a phase; move or delete its tasks when present" } }, async (request, reply) => {
    const options = phaseDeleteSchema.parse(request.body ?? {});
    await service.delete(requestContext(request), request.params.id, options);
    return reply.code(204).send();
  });
}
