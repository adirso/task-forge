import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";
import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";

const execFile = promisify(execFileCallback);
const root = mkdtempSync(path.join(tmpdir(), "taskforge-backup-test-"));
const sourceDatabase = path.join(root, "source.db");
const sourceAttachments = path.join(root, "source-attachments");
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_PATH = sourceDatabase;
process.env.ATTACHMENTS_PATH = sourceAttachments;
process.env.JWT_SECRET = "test-secret-at-least-long-enough";
process.env.TEST = "1";

const database = await import("../src/db/database.js");
const backup = await import("../src/backup.js");
const { db } = database;

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  task: "30000000-0000-4000-8000-000000000001",
  update: "40000000-0000-4000-8000-000000000001",
  attachment: "50000000-0000-4000-8000-000000000001",
  token: "60000000-0000-4000-8000-000000000001",
};

async function seed() {
  const now = "2026-08-23T00:00:00.000Z";
  await db.prepare("INSERT INTO users (id, email, name, password_hash, kind, role, webhook_url, webhook_secret_ciphertext, webhook_secret_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(ids.user, "restore@example.test", "Restore User", "password-hash", "HUMAN", "ADMIN", "https://agent.example.test/hook", "encrypted-secret", 3, now);
  await db.prepare("INSERT INTO projects (id, `key`, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ids.project, "RST", "Restore Project", "Representative backup project", ids.user, now, now);
  await db.prepare("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, type, creator_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(ids.task, ids.project, 1, "Round-trip task", "A task that must survive restore", "Rows and files are preserved", "IN_PROGRESS", "HIGH", "FEATURE", ids.user, 0, now, now);
  await db.prepare("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ids.update, ids.task, ids.user, "A note that must survive restore", now, now);
  await db.prepare("INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, token_ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ids.token, ids.user, "restore-token", "tf_test", "hash-that-is-not-a-secret", "encrypted-token", now);
  await fs.mkdir(sourceAttachments, { recursive: true });
  await fs.writeFile(path.join(sourceAttachments, ids.attachment), "attachment survives restore");
  await db.prepare("INSERT INTO task_attachments (id, task_id, file_name, mime_type, file_size, storage_key, uploaded_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(ids.attachment, ids.task, "evidence.txt", "text/plain", 28, ids.attachment, ids.user, now);
}

async function rewriteArchive(source: string, destination: string, mutate: (staging: string) => Promise<void>) {
  const staging = await fs.mkdtemp(path.join(root, "archive-edit-"));
  try {
    await execFile("tar", ["-xzf", source, "-C", staging]);
    await mutate(staging);
    await execFile("tar", ["-czf", destination, "-C", staging, "manifest.json", "database.sqlite", "attachments"]);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

await seed();

after(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("SQLite backup round-trips data, attachments, redaction, and secure mode", async () => {
  const archivePath = path.join(root, "workspace.tar.gz");
  const manifest = await backup.createBackup({ outputPath: archivePath, databasePath: sourceDatabase, attachmentsPath: sourceAttachments, databaseDriver: "sqlite" });
  assert.equal(manifest.formatVersion, 1);
  assert.deepEqual(manifest.redacted, ["users.password_hash", "users.webhook_url", "users.webhook_secret_ciphertext", "users.webhook_secret_version", "api_tokens"]);
  assert.ok(manifest.files["database.sqlite"]);
  assert.ok(manifest.files[`attachments/${ids.attachment}`]);

  const restoredDatabase = path.join(root, "restored.db");
  const restoredAttachments = path.join(root, "restored-attachments");
  await backup.restoreBackup({ inputPath: archivePath, databasePath: restoredDatabase, attachmentsPath: restoredAttachments, databaseDriver: "sqlite" });
  const restored = new Sqlite(restoredDatabase, { readonly: true });
  assert.equal(restored.prepare("SELECT name FROM projects WHERE id = ?").get(ids.project)?.name, "Restore Project");
  assert.equal(restored.prepare("SELECT body FROM task_updates WHERE id = ?").get(ids.update)?.body, "A note that must survive restore");
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM api_tokens").get()?.count, 0);
  assert.equal(restored.prepare("SELECT password_hash, webhook_url, webhook_secret_ciphertext FROM users WHERE id = ?").get(ids.user)?.password_hash, null);
  restored.close();
  assert.equal(await fs.readFile(path.join(restoredAttachments, ids.attachment), "utf8"), "attachment survives restore");

  const secureArchive = path.join(root, "workspace-secure.tar.gz");
  await backup.createBackup({ outputPath: secureArchive, databasePath: sourceDatabase, attachmentsPath: sourceAttachments, databaseDriver: "sqlite", includeSecrets: true });
  const secureDatabase = path.join(root, "secure.db");
  const secureAttachments = path.join(root, "secure-attachments");
  await backup.restoreBackup({ inputPath: secureArchive, databasePath: secureDatabase, attachmentsPath: secureAttachments, databaseDriver: "sqlite" });
  const secure = new Sqlite(secureDatabase, { readonly: true });
  assert.equal(secure.prepare("SELECT password_hash FROM users WHERE id = ?").get(ids.user)?.password_hash, "password-hash");
  assert.equal(secure.prepare("SELECT COUNT(*) AS count FROM api_tokens").get()?.count, 1);
  secure.close();
});

test("corrupt and incomplete archives fail before overwriting an existing restore", async () => {
  const sourceArchive = path.join(root, "workspace-for-failure.tar.gz");
  await backup.createBackup({ outputPath: sourceArchive, databasePath: sourceDatabase, attachmentsPath: sourceAttachments, databaseDriver: "sqlite" });
  const targetDatabase = path.join(root, "failure-target.db");
  const targetAttachments = path.join(root, "failure-attachments");
  await backup.restoreBackup({ inputPath: sourceArchive, databasePath: targetDatabase, attachmentsPath: targetAttachments, databaseDriver: "sqlite" });
  const originalDatabase = await fs.readFile(targetDatabase);
  const originalAttachment = await fs.readFile(path.join(targetAttachments, ids.attachment));

  await backup.restoreBackup({ inputPath: sourceArchive, databasePath: targetDatabase, attachmentsPath: targetAttachments, databaseDriver: "sqlite", force: true });
  const retainedDatabaseCopies = (await fs.readdir(root)).filter((entry) => entry.startsWith("failure-target.db.previous-"));
  const retainedAttachmentCopies = (await fs.readdir(root)).filter((entry) => entry.startsWith("failure-attachments.previous-"));
  assert.equal(retainedDatabaseCopies.length, 1);
  assert.equal(retainedAttachmentCopies.length, 1);
  assert.deepEqual(await fs.readFile(path.join(root, retainedDatabaseCopies[0])), originalDatabase);
  assert.deepEqual(await fs.readFile(path.join(root, retainedAttachmentCopies[0], ids.attachment)), originalAttachment);

  const missingArchive = path.join(root, "missing-file.tar.gz");
  await rewriteArchive(sourceArchive, missingArchive, async (staging) => { await fs.rm(path.join(staging, "attachments", ids.attachment)); });
  await assert.rejects(backup.restoreBackup({ inputPath: missingArchive, databasePath: targetDatabase, attachmentsPath: targetAttachments, databaseDriver: "sqlite", force: true }), /missing|checksum|attachment/i);
  assert.deepEqual(await fs.readFile(targetDatabase), originalDatabase);
  assert.deepEqual(await fs.readFile(path.join(targetAttachments, ids.attachment)), originalAttachment);

  const corruptArchive = path.join(root, "corrupt-file.tar.gz");
  await rewriteArchive(sourceArchive, corruptArchive, async (staging) => {
    const manifest = JSON.parse(await fs.readFile(path.join(staging, "manifest.json"), "utf8"));
    manifest.files["database.sqlite"].sha256 = "0".repeat(64);
    await fs.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest));
  });
  await assert.rejects(backup.restoreBackup({ inputPath: corruptArchive, databasePath: targetDatabase, attachmentsPath: targetAttachments, databaseDriver: "sqlite", force: true }), /checksum/i);
  assert.deepEqual(await fs.readFile(targetDatabase), originalDatabase);
  assert.deepEqual(await fs.readFile(path.join(targetAttachments, ids.attachment)), originalAttachment);
  await assert.rejects(backup.restoreBackup({ inputPath: sourceArchive, databasePath: targetDatabase, attachmentsPath: targetAttachments, databaseDriver: "sqlite" }), /not empty|force/i);
});

test("backup refuses a database row whose attachment file is missing", async () => {
  await fs.rm(path.join(sourceAttachments, ids.attachment));
  await assert.rejects(backup.createBackup({ outputPath: path.join(root, "missing-source.tar.gz"), databasePath: sourceDatabase, attachmentsPath: sourceAttachments, databaseDriver: "sqlite" }), /missing/i);
});

test("MySQL backup round-trips representative rows and attachments", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const baseUrl = new URL(process.env.TEST_DATABASE_URL!);
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/";
  const admin = await mysql.createConnection(adminUrl.toString());
  const sourceName = `taskforge_backup_source_${crypto.randomUUID().replaceAll("-", "")}`;
  const targetName = `taskforge_backup_target_${crypto.randomUUID().replaceAll("-", "")}`;
  const sourceUrl = new URL(baseUrl);
  sourceUrl.pathname = `/${sourceName}`;
  const targetUrl = new URL(baseUrl);
  targetUrl.pathname = `/${targetName}`;
  const sourceAttachments = path.join(root, "mysql-source-attachments");
  const targetAttachments = path.join(root, "mysql-target-attachments");
  await admin.query(`CREATE DATABASE \`${sourceName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`CREATE DATABASE \`${targetName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  try {
    const sourceAdapter = database.createMysqlAdapter(sourceUrl.toString());
    await database.runMigrations(sourceAdapter, "mysql");
    await sourceAdapter.close();
    const connection = await mysql.createConnection(sourceUrl.toString());
    const now = "2026-08-23T00:00:00.000Z";
    await connection.execute("INSERT INTO users (id, email, name, password_hash, kind, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [ids.user, "mysql-restore@example.test", "MySQL Restore User", "password-hash", "HUMAN", "ADMIN", now]);
    await connection.execute("INSERT INTO projects (id, `key`, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [ids.project, "MSR", "MySQL Restore Project", "", ids.user, now, now]);
    await connection.execute("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, type, creator_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [ids.task, ids.project, 1, "MySQL task", "", "", "TODO", "MEDIUM", "FEATURE", ids.user, 0, now, now]);
    await connection.execute("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [ids.update, ids.task, ids.user, "MySQL note", now, now]);
    await connection.execute("INSERT INTO task_attachments (id, task_id, file_name, mime_type, file_size, storage_key, uploaded_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [ids.attachment, ids.task, "mysql.txt", "text/plain", 12, ids.attachment, ids.user, now]);
    await connection.end();
    await fs.mkdir(sourceAttachments, { recursive: true });
    await fs.writeFile(path.join(sourceAttachments, ids.attachment), "mysql content");
    const archivePath = path.join(root, "mysql-workspace.tar.gz");
    await backup.createBackup({ outputPath: archivePath, databaseDriver: "mysql", databaseUrl: sourceUrl.toString(), attachmentsPath: sourceAttachments });
    await backup.restoreBackup({ inputPath: archivePath, databaseDriver: "mysql", databaseUrl: targetUrl.toString(), attachmentsPath: targetAttachments });
    const restored = await mysql.createConnection(targetUrl.toString());
    const [rows] = await restored.execute("SELECT name FROM projects WHERE id = ?", [ids.project]);
    assert.equal((rows as Array<{ name: string }>)[0]?.name, "MySQL Restore Project");
    const [notes] = await restored.execute("SELECT body FROM task_updates WHERE id = ?", [ids.update]);
    assert.equal((notes as Array<{ body: string }>)[0]?.body, "MySQL note");
    await restored.end();
    assert.equal(await fs.readFile(path.join(targetAttachments, ids.attachment), "utf8"), "mysql content");
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${sourceName}\``);
    await admin.query(`DROP DATABASE IF EXISTS \`${targetName}\``);
    await admin.end();
  }
});
