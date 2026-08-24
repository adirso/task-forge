import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { TaskGateApplicationService } from "../application/gate-service.js";

const service = new TaskGateApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });
const sha = z.string().regex(/^[0-9a-f]{7,64}$/i);
const evidence = z.object({ headSha: sha, requiredChecks: z.array(z.string().trim().min(1).max(160)).max(100), checks: z.array(z.object({ name: z.string().trim().min(1).max(160), status: z.enum(["PASS", "FAIL", "PENDING"]), headSha: sha, detailsUrl: z.string().url().nullable().optional() })).max(200) });
const head = z.object({ headSha: sha });

export async function gateRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { taskId: string } }>("/tasks/:taskId/gate", async (request) => ({ gate: await service.get(context(request), request.params.taskId) }));
  app.put<{ Params: { taskId: string } }>("/tasks/:taskId/gate", async (request) => ({ gate: await service.record(context(request), request.params.taskId, evidence.parse(request.body)) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/gate/approve", async (request) => ({ gate: await service.approve(context(request), request.params.taskId, head.parse(request.body).headSha) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/gate/merge", async (request) => ({ gate: await service.merge(context(request), request.params.taskId, head.parse(request.body).headSha) }));
}
