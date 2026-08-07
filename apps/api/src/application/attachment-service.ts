import { randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AttachmentEntity } from "./models.js";
import type { AttachmentService } from "./services.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export interface AttachmentStorage {
  save(key: string, data: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

const MAX_BYTES = 25 * 1024 * 1024;
const allowedMime = (mimeType: string) => mimeType === "application/pdf" || mimeType.startsWith("image/") || ["text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mimeType);

export class AttachmentApplicationService implements AttachmentService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly storage: AttachmentStorage, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID) {}

  async list(context: RequestContext, taskId: string) { return this.unitOfWork.run(async (repositories) => { const task = await this.authorizeTask(repositories, context, taskId); return repositories.attachments.listForTask(task.id); }); }
  async get(context: RequestContext, attachmentId: string) { return this.unitOfWork.run(async (repositories) => { const attachment = await repositories.attachments.findById(attachmentId); if (!attachment) throw new NotFoundError("Attachment"); await this.authorizeTask(repositories, context, attachment.taskId); return attachment; }); }
  async upload(context: RequestContext, taskId: string, input: { fileName: string; mimeType: string; data: string }) { return this.unitOfWork.run(async (repositories) => { const task = await this.authorizeTask(repositories, context, taskId); const mimeType = input.mimeType.toLowerCase(); if (!allowedMime(mimeType)) throw new ValidationError("Unsupported attachment type"); const encoded = input.data.replace(/^data:[^;]+;base64,/, ""); let data: Buffer; try { data = Buffer.from(encoded, "base64"); } catch { throw new ValidationError("Attachment data is invalid"); } if (!data.length || data.length > MAX_BYTES) throw new ValidationError("Attachments must be smaller than 25 MB"); const id = this.newId(); const attachment: AttachmentEntity = { id, taskId: task.id, fileName: input.fileName, mimeType, size: data.length, storageKey: id, uploadedById: context.actor.userId, createdAt: this.now() }; await this.storage.save(attachment.storageKey, data); try { const created = await repositories.attachments.create(attachment); return { ...created, uploadedBy: await repositories.users.findById(context.actor.userId) ?? undefined }; } catch (error) { await this.storage.remove(attachment.storageKey); throw error; } }); }
  async remove(context: RequestContext, attachmentId: string) { return this.unitOfWork.run(async (repositories) => { const attachment = await repositories.attachments.findById(attachmentId); if (!attachment) throw new NotFoundError("Attachment"); const task = await this.authorizeTask(repositories, context, attachment.taskId); if (context.actor.role !== "ADMIN" && task.creatorId !== context.actor.userId && attachment.uploadedById !== context.actor.userId) throw new ForbiddenError("Only the uploader, task creator, or an administrator can remove an attachment"); await repositories.attachments.delete(attachmentId); await this.storage.remove(attachment.storageKey); }); }

  private async authorizeTask(repositories: RepositorySet, context: RequestContext, taskId: string) { const task = await repositories.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(task.projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return task; }
}
