import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentArtifactCreateSchema, type AgentArtifact } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AgentArtifactApplicationService } from "../application/artifact-service.js";
import type { AgentArtifactEntity } from "../application/models.js";
import type { TokenScope } from "../application/context.js";

const service = new AgentArtifactApplicationService(createUnitOfWork(db));
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: (request.authUser.tokenScopes ?? null) as TokenScope[] | null } });
const query = z.object({ headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).optional() });
const response = (artifact: AgentArtifactEntity): AgentArtifact => ({ id: artifact.id, runId: artifact.runId, taskId: artifact.taskId, projectId: artifact.projectId, headSha: artifact.headSha, type: artifact.type, name: artifact.name, mediaType: artifact.mediaType, size: artifact.size, contentHash: artifact.contentHash, metadata: artifact.metadata, createdById: artifact.createdById, createdAt: artifact.createdAt, downloadUrl: `/api/artifacts/${artifact.id}/content` });

export async function artifactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.post<{ Params: { id: string } }>("/runs/:id/artifacts", async (request, reply) => { const result = await service.create(context(request), request.params.id, agentArtifactCreateSchema.parse(request.body)); return reply.code(result.created ? 201 : 200).send({ artifact: response(result.artifact), created: result.created }); });
  app.get<{ Params: { id: string } }>("/runs/:id/artifacts", async (request) => ({ artifacts: (await service.listForRun(context(request), request.params.id)).map(response) }));
  app.get<{ Params: { id: string } }>("/tasks/:id/artifacts", async (request) => ({ artifacts: (await service.listForTask(context(request), request.params.id, query.parse(request.query).headSha)).map(response) }));
  app.get<{ Params: { id: string } }>("/artifacts/:id/content", async (request, reply) => { const artifact = await service.get(context(request), request.params.id); return reply.type(artifact.mediaType).header("Content-Digest", `sha-256=:${Buffer.from(artifact.contentHash, "hex").toString("base64")}:`).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`).send(artifact.content); });
}
