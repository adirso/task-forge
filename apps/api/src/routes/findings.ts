import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { TaskFindingApplicationService } from "../application/finding-service.js";

const service = new TaskFindingApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });
const createSchema = z.object({ severity: z.enum(["P0", "P1", "P2", "P3"]), title: z.string().trim().min(1).max(255), body: z.string().trim().min(1).max(20_000), filePath: z.string().trim().max(1024).nullable().optional(), lineNumber: z.number().int().positive().nullable().optional(), runId: z.string().uuid().nullable().optional() });
const dispositionSchema = z.object({ disposition: z.enum(["ACCEPTED", "FIX_NEEDED", "DEFERRED", "REJECTED", "ESCALATED"]), reason: z.string().trim().max(5000).nullable().optional(), decisionOwnerId: z.string().uuid().nullable().optional(), dueAt: z.string().datetime().nullable().optional() });

export async function findingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { taskId: string } }>("/tasks/:taskId/findings", async (request) => ({ findings: await service.list(context(request), request.params.taskId) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/findings", async (request, reply) => reply.code(201).send({ finding: await service.create(context(request), request.params.taskId, createSchema.parse(request.body)) }));
  app.post<{ Params: { findingId: string } }>("/findings/:findingId/disposition", async (request) => ({ finding: await service.dispose(context(request), request.params.findingId, dispositionSchema.parse(request.body)) }));
}
