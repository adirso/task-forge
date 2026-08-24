import type { FastifyInstance } from "fastify";
import { memberAddSchema, projectCreateSchema, projectOrderSchema, projectUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { ProjectApplicationService } from "../application/resource-services.js";

type ProjectParams = { id: string };
const service = new ProjectApplicationService(createUnitOfWork(db));
const requestContext = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });
const projectContext = (request: Parameters<typeof requestContext>[0], projectId: string) => ({ ...requestContext(request), projectId });

export async function projectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get("/", { schema: { tags: ["Projects"], summary: "List accessible projects" } }, async (request) => ({ projects: await service.list(requestContext(request)) }));
  app.post("/", { schema: { tags: ["Projects"], summary: "Create a project" } }, async (request, reply) => { const body = projectCreateSchema.parse(request.body); try { return reply.code(201).send({ project: await service.create(requestContext(request), { ...body, repoUrl: body.repoUrl ?? null, localRepoPath: body.localRepoPath ?? null }) }); } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "CONFLICT") return reply.code(409).send({ error: `Project key ${body.key} is already in use` }); throw error; } });
  app.patch("/order", { schema: { tags: ["Projects"], summary: "Reorder accessible projects" } }, async (request, reply) => { await service.reorder(requestContext(request), projectOrderSchema.parse(request.body).projectIds); return reply.code(204).send(); });
  app.get<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Get a project" } }, async (request) => ({ project: await service.get(projectContext(request, request.params.id)) }));
  app.patch<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Update a project" } }, async (request) => ({ project: await service.update(projectContext(request, request.params.id), projectUpdateSchema.parse(request.body)) }));
  app.post<{ Params: ProjectParams }>("/:id/members", { schema: { tags: ["Projects"], summary: "Add a project member" } }, async (request, reply) => { const body = memberAddSchema.parse(request.body); await service.addMember(projectContext(request, request.params.id), body.userId, body.role); return reply.code(204).send(); });
  app.delete<{ Params: ProjectParams & { userId: string } }>("/:id/members/:userId", { schema: { tags: ["Projects"], summary: "Remove a project member" } }, async (request, reply) => { await service.removeMember(projectContext(request, request.params.id), request.params.userId); return reply.code(204).send(); });
  app.delete<{ Params: ProjectParams }>("/:id", { schema: { tags: ["Projects"], summary: "Delete a project and all of its data" } }, async (request, reply) => { await service.delete(projectContext(request, request.params.id)); return reply.code(204).send(); });
}
