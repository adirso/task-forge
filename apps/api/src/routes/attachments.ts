import type { FastifyInstance } from "fastify";
import { attachmentUploadSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { LocalAttachmentStorage } from "../infrastructure/attachment-storage.js";
import { AttachmentApplicationService } from "../application/attachment-service.js";

type TaskParams = { id: string };
type AttachmentParams = { id: string };
const storage = new LocalAttachmentStorage();
const service = new AttachmentApplicationService(createUnitOfWork(db), storage);
const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name } });
const response = (attachment: Awaited<ReturnType<AttachmentApplicationService["list"]>>[number]) => ({ id: attachment.id, taskId: attachment.taskId, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, uploadedBy: attachment.uploadedBy, downloadUrl: `/api/attachments/${attachment.id}/download` });

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  app.get<{ Params: TaskParams }>("/tasks/:id/attachments", { schema: { tags: ["Attachments"], summary: "List task attachments" } }, async (request) => ({ attachments: (await service.list(context(request), request.params.id)).map(response) }));
  app.post<{ Params: TaskParams }>("/tasks/:id/attachments", { schema: { tags: ["Attachments"], summary: "Upload a task attachment" } }, async (request, reply) => { const parsed = attachmentUploadSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues }); return reply.code(201).send({ attachment: response(await service.upload(context(request), request.params.id, parsed.data)) }); });
  app.get<{ Params: AttachmentParams }>("/attachments/:id/download", { schema: { tags: ["Attachments"], summary: "Download a task attachment" } }, async (request, reply) => { const attachment = await service.get(context(request), request.params.id); const data = await storage.read(attachment.storageKey); return reply.type(attachment.mimeType).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`).send(data); });
  app.delete<{ Params: AttachmentParams }>("/attachments/:id", { schema: { tags: ["Attachments"], summary: "Remove a task attachment" } }, async (request, reply) => { await service.remove(context(request), request.params.id); return reply.code(204).send(); });
}
