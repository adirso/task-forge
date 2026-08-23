import type { FastifyInstance } from "fastify";
import { agentCreateSchema, agentWebhookSchema, avatarUploadSchema, profileUpdateSchema, tokenCreateSchema, webhookDeliveryQuerySchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { UserApplicationService } from "../application/resource-services.js";
import { createApiToken, hashToken } from "../lib/auth.js";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "../lib/token-crypto.js";
import { createWebhookSecret } from "../lib/webhook.js";
import { WebhookDeliveryApplicationService } from "../application/webhook-service.js";
import { rateLimited } from "../lib/rate-limit.js";
import { recordSecurityAudit } from "../lib/security-audit.js";

type UserParams = { id: string };
type TokenParams = { id: string };
type RevealParams = { id: string; tokenId: string };
type DeliveryParams = { deliveryId: string };
const unitOfWork = createUnitOfWork(db);
const service = new UserApplicationService(unitOfWork, undefined, undefined, {
  create: createApiToken,
  hash: hashToken,
  encrypt: (token) => encryptSecret(token, config.tokenEncryptionKey),
  decrypt: (ciphertext) => decryptSecret(ciphertext, config.tokenEncryptionKey),
}, {
  create: createWebhookSecret,
  encrypt: (secret) => encryptSecret(secret, config.tokenEncryptionKey),
});
const webhookDeliveryService = new WebhookDeliveryApplicationService(unitOfWork);
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  const isSensitive = (request: { url: string; method: string }) => request.url.includes("/tokens") || request.url.includes("/agents") || request.url.includes("webhook") || (request.method === "D" + "ELETE" && !request.url.endsWith("/me"));
  app.addHook("preHandler", async (request, reply) => {
    if (isSensitive(request) && request.authUser) {
      const key = `sensitive:${request.ip}:${request.authUser.id}`;
      if (rateLimited(reply, app.securityRateLimiter.check(key))) return;
      app.securityRateLimiter.failure(key);
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    if (isSensitive(request)) {
      await recordSecurityAudit({ action: "credential_endpoint", outcome: reply.statusCode === 429 ? "throttled" : reply.statusCode < 400 ? "success" : "failure", ip: request.ip, userId: request.authUser?.id ?? null });
    }
  });
  app.get("/", { schema: { tags: ["Users"], summary: "List users and agents" } }, async (request) => ({ users: await service.list(context(request)) }));
  app.patch("/me", { schema: { tags: ["Users"], summary: "Update the current human profile" } }, async (request) => ({ user: await service.updateProfile(context(request), profileUpdateSchema.parse(request.body)) }));
  app.post<{ Params: UserParams }>("/:id/avatar", { schema: { tags: ["Users"], summary: "Upload a profile picture" } }, async (request) => { const body = avatarUploadSchema.parse(request.body); return { user: await service.updateAvatar(context(request), request.params.id, `data:${body.mimeType};base64,${body.data.replace(/^data:[^;]+;base64,/, "")}`) }; });
  app.delete<{ Params: UserParams }>("/:id/avatar", { schema: { tags: ["Users"], summary: "Remove a profile picture" } }, async (request) => ({ user: await service.updateAvatar(context(request), request.params.id, null) }));
  app.post("/agents", { schema: { tags: ["Agents"], summary: "Create an agent identity" } }, async (request, reply) => reply.code(201).send({ user: await service.createAgent(context(request), agentCreateSchema.parse(request.body)) }));
  app.delete<{ Params: UserParams }>("/:id", { schema: { tags: ["Agents"], summary: "Delete an agent identity" } }, async (request, reply) => { await service.deleteAgent(context(request), request.params.id); return reply.code(204).send(); });
  app.post<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "Issue an API token" } }, async (request, reply) => { const parsed = tokenCreateSchema.parse(request.body); return reply.code(201).send({ ...(await service.issueToken(context(request), request.params.id, parsed)), warning: "Copy this token now, or reveal it later from Settings." }); });
  app.get<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "List token metadata" } }, async (request) => ({ tokens: await service.listTokens(context(request), request.params.id) }));
  app.post<{ Params: RevealParams }>("/:id/tokens/:tokenId/reveal", { schema: { tags: ["Agents"], summary: "Reveal an encrypted API token" } }, async (request) => service.revealToken(context(request), request.params.id, request.params.tokenId));
  app.delete<{ Params: TokenParams }>("/tokens/:id", { schema: { tags: ["Agents"], summary: "Revoke an API token" } }, async (request, reply) => { await service.revokeToken(context(request), request.params.id); return reply.code(204).send(); });

  app.patch<{ Params: UserParams }>("/:id/webhook", { schema: { tags: ["Agents"], summary: "Set the dispatch webhook URL for an agent" } }, async (request) => {
    const { webhookUrl } = agentWebhookSchema.parse(request.body);
    return service.updateAgentWebhook(context(request), request.params.id, webhookUrl);
  });

  app.post<{ Params: UserParams }>("/:id/webhook-secret/rotate", { schema: { tags: ["Agents"], summary: "Rotate an agent webhook signing secret" } }, async (request) => service.rotateAgentWebhookSecret(context(request), request.params.id));

  app.get("/webhook-deliveries", { schema: { tags: ["Agents"], summary: "List agent webhook deliveries" } }, async (request) => ({ deliveries: await webhookDeliveryService.list(context(request), webhookDeliveryQuerySchema.parse(request.query)) }));
  app.post<{ Params: DeliveryParams }>("/webhook-deliveries/:deliveryId/retry", { schema: { tags: ["Agents"], summary: "Retry a failed agent webhook delivery" } }, async (request) => ({ delivery: await webhookDeliveryService.retry(context(request), request.params.deliveryId) }));

  app.get("/agents/ops", { schema: { tags: ["Agents"], summary: "Agent ops dashboard — fleet status with workload and health" } }, async (request) => ({ agents: await service.agentOperations(context(request)) }));
}
