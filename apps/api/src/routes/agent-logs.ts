import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { pageRequest } from "../infrastructure/pagination.js";
import { AgentLogApplicationService } from "../application/agent-log-service.js";

type ContextRequest = { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } };
const context = (request: ContextRequest) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });
const service = new AgentLogApplicationService(createUnitOfWork(db));
const logSchema = z.object({ runId: z.string().uuid().nullable().optional(), provider: z.string().trim().min(1).max(64), stream: z.enum(["stdout", "stderr", "system", "callback"]), category: z.enum(["output", "progress", "tool", "callback", "lifecycle"]).default("output"), sequence: z.number().int().min(0), eventId: z.string().trim().max(180).nullable().optional(), content: z.string().min(1).max(10_000) });

export async function agentLogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/tasks/:id/agent-logs", async (request) => { const result = await service.list(context(request), request.params.id, pageRequest(request.query)); return { agentLogs: result.items, page: result.page }; });
  app.post<{ Params: { id: string } }>("/tasks/:id/agent-logs", async (request, reply) => { const input = logSchema.parse(request.body); const agentLog = await service.append(context(request), request.params.id, { ...input, runId: input.runId ?? null, eventId: input.eventId ?? null }); return reply.code(agentLog ? 201 : 200).send({ agentLog, duplicate: !agentLog }); });
}
