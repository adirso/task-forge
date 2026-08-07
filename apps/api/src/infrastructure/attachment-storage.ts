import fs from "node:fs/promises";
import path from "node:path";
import type { AttachmentStorage } from "../application/attachment-service.js";
import { config } from "../config.js";

export class LocalAttachmentStorage implements AttachmentStorage {
  async save(key: string, data: Buffer) { await fs.mkdir(config.attachmentsPath, { recursive: true }); await fs.writeFile(path.join(config.attachmentsPath, key), data, { flag: "wx" }); }
  async remove(key: string) { await fs.rm(path.join(config.attachmentsPath, key), { force: true }); }
  async read(key: string) { return fs.readFile(path.join(config.attachmentsPath, key)); }
}
