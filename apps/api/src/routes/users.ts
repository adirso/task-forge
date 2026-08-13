import type { FastifyInstance } from "fastify";
import { agentCreateSchema, avatarUploadSchema, profileUpdateSchema, tokenCreateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { UserApplicationService } from "../application/resource-services.js";
import { createApiToken, hashToken } from "../lib/auth.js";
import { config } from "../config.js";
import { decryptSecret, encryptSecret } from "../lib/token-crypto.js";

type UserParams = { id: string };
type TokenParams = { id: string };
type RevealParams = { id: string; tokenId: string };
const service = new UserApplicationService(createUnitOfWork(db), undefined, undefined, {
  create: createApiToken,
  hash: hashToken,
  encrypt: (token) => encryptSecret(token, config.tokenEncryptionKey),
  decrypt: (ciphertext) => decryptSecret(ciphertext, config.tokenEncryptionKey),
});
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get("/", { schema: { tags: ["Users"], summary: "List users and agents" } }, async (request) => ({ users: await service.list(context(request)) }));
  app.patch("/me", { schema: { tags: ["Users"], summary: "Update the current human profile" } }, async (request) => ({ user: await service.updateProfile(context(request), profileUpdateSchema.parse(request.body)) }));
  app.post<{ Params: UserParams }>("/:id/avatar", { schema: { tags: ["Users"], summary: "Upload a profile picture" } }, async (request) => { const body = avatarUploadSchema.parse(request.body); return { user: await service.updateAvatar(context(request), request.params.id, `data:${body.mimeType};base64,${body.data.replace(/^data:[^;]+;base64,/, "")}`) }; });
  app.delete<{ Params: UserParams }>("/:id/avatar", { schema: { tags: ["Users"], summary: "Remove a profile picture" } }, async (request) => ({ user: await service.updateAvatar(context(request), request.params.id, null) }));
  app.post("/agents", { schema: { tags: ["Agents"], summary: "Create an agent identity" } }, async (request, reply) => reply.code(201).send({ user: await service.createAgent(context(request), agentCreateSchema.parse(request.body)) }));
  app.delete<{ Params: UserParams }>("/:id", { schema: { tags: ["Agents"], summary: "Delete an agent identity" } }, async (request, reply) => { await service.deleteAgent(context(request), request.params.id); return reply.code(204).send(); });
  app.post<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "Issue an API token" } }, async (request, reply) => reply.code(201).send({ ...(await service.issueToken(context(request), request.params.id, tokenCreateSchema.parse(request.body))), warning: "Copy this token now, or reveal it later from Settings." }));
  app.get<{ Params: UserParams }>("/:id/tokens", { schema: { tags: ["Agents"], summary: "List token metadata" } }, async (request) => ({ tokens: await service.listTokens(context(request), request.params.id) }));
  app.post<{ Params: RevealParams }>("/:id/tokens/:tokenId/reveal", { schema: { tags: ["Agents"], summary: "Reveal an encrypted API token" } }, async (request) => service.revealToken(context(request), request.params.id, request.params.tokenId));
  app.delete<{ Params: TokenParams }>("/tokens/:id", { schema: { tags: ["Agents"], summary: "Revoke an API token" } }, async (request, reply) => { await service.revokeToken(context(request), request.params.id); return reply.code(204).send(); });
}
