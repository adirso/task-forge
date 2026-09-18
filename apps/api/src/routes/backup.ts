import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { BackupError, createBackup, restoreBackup, validateBackup } from "../backup.js";
import { ForbiddenError, ValidationError } from "../application/errors.js";
import { db } from "../db/database.js";
import { recordSecurityAudit } from "../lib/security-audit.js";

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/gzip", "application/x-gzip", "application/octet-stream"]);
const context = (request: { authUser: { id: string; role: "ADMIN" | "MEMBER" } }) => request.authUser;
function requireAdmin(request: { authUser: { id: string; role: "ADMIN" | "MEMBER" } }) {
  if (request.authUser.role !== "ADMIN") throw new ForbiddenError("Administrator access is required for database backups");
}
function safeFailure(error: unknown) {
  return error instanceof BackupError ? "Backup could not be validated or restored" : "Backup operation failed";
}

export async function backupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/export", async (request, reply) => {
    requireAdmin(request);
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "taskforge-export-"));
    const output = path.join(staging, "taskforge-backup.tar.gz");
    try {
      await createBackup({ outputPath: output, includeSecrets: false });
      const data = await fs.readFile(output);
      await recordSecurityAudit({ action: "database_backup_export", outcome: "success", ip: request.ip, userId: context(request).id });
      return reply.type("application/gzip").header("content-disposition", 'attachment; filename="taskforge-backup.tar.gz"').send(data);
    } catch (error) {
      await recordSecurityAudit({ action: "database_backup_export", outcome: "failure", ip: request.ip, userId: context(request).id });
      throw new BackupError(safeFailure(error));
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); }
  });

  app.post("/restore", { bodyLimit: 70 * 1024 * 1024 }, async (request, reply) => {
    requireAdmin(request);
    const body = request.body as { fileName?: unknown; mimeType?: unknown; data?: unknown };
    const fileName = typeof body?.fileName === "string" ? body.fileName : "";
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
    const encoded = typeof body?.data === "string" ? body.data : "";
    if (!/\.(?:tar\.gz|tgz)$/i.test(fileName) || !ALLOWED_TYPES.has(mimeType)) throw new ValidationError("Backup file type is not supported");
    const data = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!data.length || data.length > MAX_BACKUP_BYTES) throw new ValidationError("Backup file size is not supported");
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "taskforge-upload-"));
    const input = path.join(staging, `${crypto.randomUUID()}.tar.gz`);
    const preimage = db.dialect === "mysql" ? path.join(staging, "preimage.tar.gz") : null;
    let closed = false;
    try {
      await fs.writeFile(input, data, { mode: 0o600 });
      const manifest = await validateBackup({ inputPath: input, databaseDriver: db.dialect });
      if (preimage) await createBackup({ outputPath: preimage, includeSecrets: true, databaseDriver: db.dialect });
      await db.close();
      closed = true;
      await restoreBackup({ inputPath: input, force: true, databaseDriver: manifest.databaseDriver });
      await db.reopen();
      closed = false;
      await recordSecurityAudit({ action: "database_backup_restore", outcome: "success", ip: request.ip, userId: context(request).id });
      return reply.send({ restored: true, backup: { formatVersion: manifest.formatVersion, databaseDriver: manifest.databaseDriver, createdAt: manifest.createdAt } });
    } catch (error) {
      if (closed) {
        if (preimage) await restoreBackup({ inputPath: preimage, force: true, databaseDriver: "mysql" }).catch(() => {});
        await db.reopen().catch(() => {});
      }
      await recordSecurityAudit({ action: "database_backup_restore", outcome: "failure", ip: request.ip, userId: context(request).id });
      if (error instanceof BackupError) throw new ValidationError(safeFailure(error));
      throw new BackupError(safeFailure(error));
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); }
  });
}
