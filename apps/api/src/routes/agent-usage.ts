import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentBudgetScopeSchema, agentBudgetUpsertSchema, agentUsageEventInputSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AgentUsageApplicationService } from "../application/agent-usage-service.js";
import type { TokenScope } from "../application/context.js";
const service = new AgentUsageApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as TokenScope[] | null } });
const reportQuery = z.object({ phaseId: z.string().uuid().optional(), taskId: z.string().uuid().optional(), provider: z.string().trim().max(64).optional(), model: z.string().trim().max(120).optional() });
export async function agentUsageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.post<{ Params: { id: string } }>("/runs/:id/usage", async (request, reply) => { const result = await service.record(context(request), request.params.id, agentUsageEventInputSchema.parse(request.body)); return reply.code(result.created ? 201 : 200).send(result); });
  app.get<{ Params: { id: string } }>("/runs/:id/usage", async (request) => ({ usage: await service.runReport(context(request), request.params.id) }));
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/agent-usage", async (request) => ({ usage: await service.projectReport(context(request), request.params.projectId, reportQuery.parse(request.query)) }));
  app.get<{ Params: { projectId: string } }>("/projects/:projectId/agent-budgets", async (request) => ({ budgets: await service.listBudgets(context(request), request.params.projectId) }));
  app.put<{ Params: { projectId: string; scope: string; scopeId: string } }>("/projects/:projectId/agent-budgets/:scope/:scopeId", async (request) => ({ budget: await service.saveBudget(context(request), request.params.projectId, agentBudgetScopeSchema.parse(request.params.scope), request.params.scopeId, agentBudgetUpsertSchema.parse(request.body)) }));
  app.delete<{ Params: { projectId: string; scope: string; scopeId: string } }>("/projects/:projectId/agent-budgets/:scope/:scopeId", async (request, reply) => { await service.deleteBudget(context(request), request.params.projectId, agentBudgetScopeSchema.parse(request.params.scope), request.params.scopeId); return reply.code(204).send(); });
}
