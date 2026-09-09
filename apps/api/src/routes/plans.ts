import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentPlanDecisionSchema, agentPlanProposalSchema } from "@taskforge/contracts";
import { AgentPlanApplicationService } from "../application/plan-service.js";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import type { AgentPlanEntity } from "../application/models.js";

const service = new AgentPlanApplicationService(createUnitOfWork(db));
const idempotencyKeySchema = z.string().trim().min(1).max(180);
const planResponse = ({ idempotencyKey: _idempotencyKey, ...plan }: AgentPlanEntity) => plan;
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });

export async function planRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { taskId: string } }>("/tasks/:taskId/plans", { schema: { tags: ["Agent plans"], summary: "List immutable agent plan versions" } }, async (request) => ({ plans: (await service.list(context(request), request.params.taskId)).map(planResponse) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/plans", { schema: { tags: ["Agent plans"], summary: "Propose an idempotent task decomposition plan" } }, async (request, reply) => {
    const key = idempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const result = await service.propose(context(request), request.params.taskId, key, agentPlanProposalSchema.parse(request.body));
    return reply.code(result.duplicate ? 200 : 201).send({ ...result, plan: planResponse(result.plan) });
  });
  app.post<{ Params: { taskId: string; planId: string } }>("/tasks/:taskId/plans/:planId/decision", { schema: { tags: ["Agent plans"], summary: "Approve or reject an agent plan" } }, async (request) => { const result = await service.decide(context(request), request.params.taskId, request.params.planId, agentPlanDecisionSchema.parse(request.body)); return { ...result, plan: planResponse(result.plan) }; });
}
