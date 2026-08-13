import type { FastifyInstance } from "fastify";
import { agentCreateSchema, agentWebhookSchema, avatarUploadSchema, profileUpdateSchema, tokenCreateSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { createRepositories } from "../infrastructure/repositories.js";
import { UserApplicationService } from "../application/resource-services.js";
import { ForbiddenError } from "../application/errors.js";
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
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as import("../application/context.js").TokenScope[] | null } });

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
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
    return { user: await service.updateAgentWebhook(context(request), request.params.id, webhookUrl) };
  });

  app.get("/agents/ops", { schema: { tags: ["Agents"], summary: "Agent ops dashboard — fleet status with workload and health" } }, async (request, reply) => {
    if (request.authUser.role !== "ADMIN") throw new ForbiddenError("Administrator access required");
    const repos = createRepositories(db);
    const allUsers = await repos.users.list();
    const agents = allUsers.filter((u) => u.kind === "AGENT");
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const result = await Promise.all(agents.map(async (agent) => {
      const [inProgressTasks, tokenRow] = await Promise.all([
        repos.tasks.listForAssignee(agent.id, "IN_PROGRESS"),
        db.prepare("SELECT MAX(last_used_at) AS last_used FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL").get(agent.id),
      ]);
      const lastActiveAt = tokenRow && tokenRow.last_used != null ? String(tokenRow.last_used) : null;
      const stuckCount = inProgressTasks.filter((t) => t.updatedAt < fourHoursAgo).length;
      return {
        id: agent.id, name: agent.name, email: agent.email, kind: agent.kind,
        role: agent.role, avatarUrl: agent.avatarUrl, webhookUrl: agent.webhookUrl ?? null,
        createdAt: agent.createdAt, lastActiveAt,
        openTaskCount: inProgressTasks.length, stuckTaskCount: stuckCount,
        inProgressTasks: inProgressTasks.map((t) => ({
          id: t.id, title: t.title, number: t.number,
          projectId: t.projectId, projectName: t.projectName ?? "", projectKey: t.projectKey ?? "",
          updatedAt: t.updatedAt, isStuck: t.updatedAt < fourHoursAgo,
        })),
      };
    }));

    return reply.send({ agents: result });
  });
}
