import type { FastifyInstance } from "fastify";
import { taskClaimSchema, taskCreateSchema, taskDependencyUpdateSchema, taskStatusSchema, taskTagNameSchema, taskTypeSchema, taskUpdateCreateSchema, taskUpdateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { TaskApplicationService } from "../application/task-service.js";
import { taskResponse } from "../lib/task-response.js";
import { pageRequest } from "../infrastructure/pagination.js";

type ProjectParams = { projectId: string };
type TaskParams = { id: string };
type TaskQuery = { status?: string; assigneeId?: string; priority?: string; type?: string; phaseId?: string; tag?: string; minPoints?: string; maxPoints?: string; q?: string; cursor?: string; limit?: string };
type PageQuery = { cursor?: string; limit?: string };
const service = new TaskApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });
const projectContext = (request: Parameters<typeof context>[0], projectId: string) => ({ ...context(request), projectId });
const numberParam = (value: string | undefined) => value === undefined ? undefined : Number(value);

export async function taskRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: ProjectParams; Querystring: TaskQuery }>("/projects/:projectId/tasks", { schema: { tags: ["Tasks"], summary: "List project tasks" } }, async (request) => {
    const query = request.query;
    const filters = { status: query.status ? taskStatusSchema.parse(query.status) : undefined, assigneeId: query.assigneeId, priority: query.priority, type: query.type ? taskTypeSchema.parse(query.type) : undefined, phaseId: query.phaseId, tag: query.tag ? taskTagNameSchema.parse(query.tag) : undefined, minPoints: numberParam(query.minPoints), maxPoints: numberParam(query.maxPoints), query: query.q };
    const result = await service.list(projectContext(request, request.params.projectId), filters, pageRequest(query));
    return { tasks: result.items.map(taskResponse), page: result.page };
  });
  app.post<{ Params: ProjectParams }>("/projects/:projectId/tasks", { schema: { tags: ["Tasks"], summary: "Create a task" } }, async (request, reply) => { const parsed = taskCreateSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues }); return reply.code(201).send({ task: taskResponse(await service.create(projectContext(request, request.params.projectId), parsed.data)) }); });
  app.get<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Get a task" } }, async (request) => ({ task: taskResponse(await service.get(context(request), request.params.id)) }));
  app.patch<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Update a task" } }, async (request, reply) => { const parsed = taskUpdateSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues }); return { task: taskResponse(await service.update(context(request), request.params.id, parsed.data)) }; });
  app.post<{ Params: TaskParams }>("/tasks/:id/dependencies", { schema: { tags: ["Tasks"], summary: "Replace a task's dependencies" } }, async (request, reply) => { const parsed = taskDependencyUpdateSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues }); return { task: taskResponse(await service.update(context(request), request.params.id, parsed.data)) }; });
  app.delete<{ Params: TaskParams }>("/tasks/:id", { schema: { tags: ["Tasks"], summary: "Delete a task and its subtasks" } }, async (request, reply) => { await service.delete(context(request), request.params.id); return reply.code(204).send(); });
  app.get<{ Params: ProjectParams }>("/projects/:projectId/tags", { schema: { tags: ["Tasks"], summary: "List reusable project tags" } }, async (request) => ({ tags: await service.listTags(projectContext(request, request.params.projectId)) }));
  app.post<{ Params: ProjectParams }>("/projects/:projectId/tasks/claim", { schema: { tags: ["Tasks"], summary: "Atomically claim the next unassigned task in a project" } }, async (request, reply) => {
    const parsed = taskClaimSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    return reply.code(200).send({ task: taskResponse(await service.claimTask(projectContext(request, request.params.projectId), parsed.data ?? {})) });
  });
  app.get<{ Params: TaskParams; Querystring: PageQuery }>("/tasks/:id/updates", { schema: { tags: ["Task updates"], summary: "List notes and updates on a task" } }, async (request) => { const result = await service.listUpdates(context(request), request.params.id, pageRequest(request.query)); return { updates: result.items, page: result.page }; });
  app.post<{ Params: TaskParams }>("/tasks/:id/updates", { schema: { tags: ["Task updates"], summary: "Post a note or progress update" } }, async (request, reply) => reply.code(201).send({ update: await service.addUpdate(context(request), request.params.id, taskUpdateCreateSchema.parse(request.body).body) }));
}
