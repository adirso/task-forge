import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AgentRunApplicationService } from "../application/run-service.js";

const service = new AgentRunApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });
const createSchema = z.object({ kind: z.enum(["IMPLEMENTATION", "REVIEW"]), maxAttempts: z.number().int().min(1).max(10).optional(), timeoutAt: z.string().datetime().nullable().optional() });
const leaseSchema = z.object({ leaseMs: z.number().int().min(5_000).max(900_000).optional() });
const completeSchema = z.object({ status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]), error: z.string().trim().max(1000).nullable().optional() });

export async function runRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { taskId: string } }>("/tasks/:taskId/runs", async (request) => ({ runs: await service.list(context(request), request.params.taskId) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/runs", async (request, reply) => reply.code(201).send({ run: await service.create(context(request), request.params.taskId, createSchema.parse(request.body)) }));
  app.post<{ Params: { id: string } }>("/runs/:id/claim", async (request) => ({ run: await service.claim(context(request), request.params.id, leaseSchema.parse(request.body ?? {}).leaseMs) }));
  app.post<{ Params: { id: string } }>("/runs/:id/heartbeat", async (request) => ({ run: await service.heartbeat(context(request), request.params.id, leaseSchema.parse(request.body ?? {}).leaseMs) }));
  app.post<{ Params: { id: string } }>("/runs/:id/complete", async (request) => ({ run: await service.complete(context(request), request.params.id, completeSchema.parse(request.body).status, completeSchema.parse(request.body).error) }));
}
