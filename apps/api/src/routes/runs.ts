import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AgentRunApplicationService } from "../application/run-service.js";
import { config } from "../config.js";
import { dispatchForceCycle } from "../lib/force-cycle.js";
import { AgentRunCredentialApplicationService } from "../application/run-credential-service.js";
import { createRunCredential, hashToken } from "../lib/auth.js";
import { decryptSecret, encryptSecret } from "../lib/token-crypto.js";
import { agentRunInterventionSchema } from "@taskforge/contracts";

const service = new AgentRunApplicationService(createUnitOfWork(db));
const credentialService = new AgentRunCredentialApplicationService(createUnitOfWork(db), {
  create: createRunCredential,
  hash: hashToken,
  encrypt: (token) => encryptSecret(token, config.tokenEncryptionKey),
  decrypt: (ciphertext) => decryptSecret(ciphertext, config.tokenEncryptionKey),
});
export const expireAgentRuns = () => service.expire();
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });
const createSchema = z.object({ kind: z.enum(["IMPLEMENTATION", "REVIEW", "RE_REVIEW", "FIX"]), maxAttempts: z.number().int().min(1).max(10).optional(), timeoutAt: z.string().datetime().nullable().optional() });
const leaseSchema = z.object({ leaseMs: z.number().int().min(5_000).max(900_000).optional(), controlVersion: z.number().int().nonnegative().optional() });
const completeSchema = z.object({ status: z.enum(["SUCCEEDED", "FAILED"]), controlVersion: z.number().int().nonnegative(), error: z.string().trim().max(1000).nullable().optional() });
const idempotencyKeySchema = z.string().trim().min(1).max(180);

export async function runRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: { taskId: string } }>("/tasks/:taskId/runs", async (request) => service.list(context(request), request.params.taskId));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/runs", async (request, reply) => reply.code(201).send({ run: await service.create(context(request), request.params.taskId, createSchema.parse(request.body)) }));
  app.post<{ Params: { taskId: string } }>("/tasks/:taskId/runs/force-cycle", async (request, reply) => {
    const requestId = idempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const result = await service.forceCycle(context(request), request.params.taskId, requestId);
    try {
      await dispatchForceCycle(result.webhook.webhookUrl!, decryptSecret(result.webhook.secretCiphertext!, config.tokenEncryptionKey), result.webhook.secretVersion, { id: result.grant.requestId, taskId: result.grant.taskId, eventId: result.grant.smithyEventId, priorCount: result.grant.priorCount, newLimit: result.grant.newLimit });
    } catch {
      return reply.code(502).send({ error: "Smithy could not start the additional cycle. Retry this action; the cycle grant will not be duplicated." });
    }
    return reply.code(202).send({ cycle: { count: result.grant.priorCount, limit: result.grant.newLimit, limitFailure: false }, duplicate: result.duplicate });
  });
  app.post<{ Params: { id: string } }>("/runs/:id/claim", async (request) => ({ run: await service.claim(context(request), request.params.id, leaseSchema.parse(request.body ?? {}).leaseMs) }));
  app.post<{ Params: { id: string } }>("/runs/:id/credential", { schema: { tags: ["Agent runs"], summary: "Issue the current lease owner a short-lived run credential" } }, async (request) => ({ credential: await credentialService.issue(context(request), request.params.id) }));
  app.delete<{ Params: { id: string } }>("/runs/:id/credential", { schema: { tags: ["Agent runs"], summary: "Revoke a run credential" } }, async (request, reply) => { await credentialService.revoke(context(request), request.params.id); return reply.code(204).send(); });
  app.post<{ Params: { id: string } }>("/runs/:id/heartbeat", async (request) => { const input = leaseSchema.required({ controlVersion: true }).parse(request.body ?? {}); return { run: await service.heartbeat(context(request), request.params.id, input.controlVersion, input.leaseMs) }; });
  app.post<{ Params: { id: string } }>("/runs/:id/complete", async (request) => { const input = completeSchema.parse(request.body); return { run: await service.complete(context(request), request.params.id, input.controlVersion, input.status, input.error) }; });
  app.post<{ Params: { id: string } }>("/runs/:id/interventions", async (request, reply) => {
    const requestId = idempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const result = await service.intervene(context(request), request.params.id, requestId, agentRunInterventionSchema.parse(request.body));
    return reply.code(result.duplicate ? 200 : 202).send(result);
  });
}
