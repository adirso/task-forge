import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import { config } from "./config.js";
import { LEGACY_MIGRATION_VERSIONS, createMysqlAdapter, migrations, runMigrations } from "./db/database.js";

const execFile = promisify(execFileCallback);
const FORMAT_VERSION = 1;
const TABLES = [
  "users", "api_tokens", "projects", "project_members", "phases", "tasks", "tags", "task_tags",
  "task_dependencies", "activity", "notifications", "task_updates", "task_attachments", "automations",
  "webhook_deliveries", "schema_migrations",
] as const;
const REDACTED_FIELDS = ["users.password_hash", "users.webhook_url", "users.webhook_secret_ciphertext", "users.webhook_secret_version", "api_tokens"];

export class BackupError extends Error {
  constructor(message: string) { super(message); this.name = "BackupError"; }
}

type Driver = "sqlite" | "mysql";
type BackupRow = Record<string, unknown>;
type BackupTables = Record<string, BackupRow[]>;

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  databaseDriver: Driver;
  includeSecrets: boolean;
  redacted: string[];
  migrationVersions: string[];
  attachmentKeys: string[];
  files: Record<string, { size: number; sha256: string }>;
}

export interface BackupOptions {
  outputPath: string;
  databaseDriver?: Driver;
  databasePath?: string;
  databaseUrl?: string;
  attachmentsPath?: string;
  includeSecrets?: boolean;
}

export interface RestoreOptions {
  inputPath: string;
  databaseDriver?: Driver;
  databasePath?: string;
  databaseUrl?: string;
  attachmentsPath?: string;
  force?: boolean;
}

function driverOf(driver?: Driver): Driver { return driver ?? config.databaseDriver; }
function attachmentsOf(attachmentsPath?: string) { return path.resolve(attachmentsPath ?? config.attachmentsPath); }
function safeKey(key: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key === "." || key === "..") throw new BackupError(`Unsafe attachment storage key: ${key}`);
  return key;
}
function safeArchivePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => part === ".." || part === "")) throw new BackupError(`Unsafe archive path: ${value}`);
  return normalized;
}
async function exists(filePath: string) { try { await fs.access(filePath); return true; } catch { return false; } }
async function hashFile(filePath: string) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new BackupError(`Backup entry is not a regular file: ${filePath}`);
  const data = await fs.readFile(filePath);
  return { size: data.byteLength, sha256: crypto.createHash("sha256").update(data).digest("hex") };
}
async function runTar(args: string[]) {
  try { return await execFile("tar", args, { maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { throw new BackupError(`tar failed: ${error instanceof Error ? error.message : String(error)}`); }
}
async function copyAttachments(keys: string[], sourcePath: string, stagingPath: string) {
  const target = path.join(stagingPath, "attachments");
  await fs.mkdir(target, { recursive: true });
  for (const rawKey of keys) {
    const key = safeKey(rawKey);
    const source = path.join(sourcePath, key);
    if (!(await exists(source))) throw new BackupError(`Attachment file is missing: ${key}`);
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw new BackupError(`Attachment path is not a regular file: ${key}`);
    await fs.copyFile(source, path.join(target, key));
  }
}
function redactTables(tables: BackupTables, includeSecrets: boolean): BackupTables {
  if (includeSecrets) return tables;
  const result = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])) as BackupTables;
  if (result.users) for (const row of result.users) {
    row.password_hash = null;
    row.webhook_url = null;
    row.webhook_secret_ciphertext = null;
    row.webhook_secret_version = 0;
  }
  if (result.api_tokens) result.api_tokens = [];
  return result;
}
function migrationVersions(tables: BackupTables) { return (tables.schema_migrations ?? []).map((row) => String(row.version)); }
function validateVersions(versions: string[]) {
  const known = new Set([...migrations.map((item) => item.version), ...LEGACY_MIGRATION_VERSIONS]);
  const unknown = versions.filter((version) => !known.has(version));
  if (unknown.length) throw new BackupError(`Backup contains unknown migration version(s): ${unknown.join(", ")}`);
}
function attachmentKeys(tables: BackupTables) { return (tables.task_attachments ?? []).map((row) => String(row.storage_key)); }

async function sqliteSnapshot(databasePath: string, stagingPath: string, includeSecrets: boolean) {
  if (!(await exists(databasePath))) throw new BackupError(`SQLite database does not exist: ${databasePath}`);
  const source = new Sqlite(databasePath, { readonly: true, fileMustExist: true });
  const keys = (source.prepare("SELECT storage_key FROM task_attachments ORDER BY storage_key").all() as Array<{ storage_key: string }>).map((row) => row.storage_key);
  const targetPath = path.join(stagingPath, "database.sqlite");
  await source.backup(targetPath);
  source.close();
  if (!includeSecrets) {
    const snapshot = new Sqlite(targetPath);
    snapshot.transaction(() => {
      snapshot.prepare("UPDATE users SET password_hash = NULL, webhook_url = NULL, webhook_secret_ciphertext = NULL, webhook_secret_version = 0").run();
      snapshot.prepare("DELETE FROM api_tokens").run();
    })();
    snapshot.close();
  }
  const inspect = new Sqlite(targetPath, { readonly: true, fileMustExist: true });
  const versions = (inspect.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>).map((row) => row.version);
  validateVersions(versions);
  const integrity = inspect.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
  inspect.close();
  if (integrity.integrity_check !== "ok") throw new BackupError(`SQLite snapshot failed integrity check: ${integrity.integrity_check}`);
  return { keys, versions, databaseName: "database.sqlite" };
}

async function mysqlSnapshot(databaseUrl: string, stagingPath: string, includeSecrets: boolean) {
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.beginTransaction();
    const tables: BackupTables = {};
    for (const table of TABLES) {
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      tables[table] = (rows as BackupRow[]).map((row) => ({ ...row }));
    }
    const result = redactTables(tables, includeSecrets);
    const versions = migrationVersions(result);
    validateVersions(versions);
    const keys = attachmentKeys(result);
    await fs.writeFile(path.join(stagingPath, "database.json"), JSON.stringify({ formatVersion: FORMAT_VERSION, tables: result }, null, 2));
    await connection.commit();
    return { keys, versions, databaseName: "database.json" };
  } catch (error) {
    await connection.rollback();
    throw error instanceof BackupError ? error : new BackupError(`MySQL snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await connection.end(); }
}

export async function createBackup(options: BackupOptions): Promise<BackupManifest> {
  const driver = driverOf(options.databaseDriver);
  const outputPath = path.resolve(options.outputPath);
  if (await exists(outputPath)) throw new BackupError(`Backup output already exists: ${outputPath}`);
  const includeSecrets = options.includeSecrets === true;
  const stagingPath = await fs.mkdtemp(path.join(os.tmpdir(), "taskforge-backup-"));
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const snapshot = driver === "sqlite"
      ? await sqliteSnapshot(path.resolve(options.databasePath ?? config.databasePath), stagingPath, includeSecrets)
      : await mysqlSnapshot(options.databaseUrl ?? config.databaseUrl!, stagingPath, includeSecrets);
    await copyAttachments(snapshot.keys, attachmentsOf(options.attachmentsPath), stagingPath);
    const files: BackupManifest["files"] = {};
    for (const relative of [snapshot.databaseName, ...snapshot.keys.map((key) => `attachments/${safeKey(key)}`)]) files[relative] = await hashFile(path.join(stagingPath, relative));
    const manifest: BackupManifest = { formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(), databaseDriver: driver, includeSecrets, redacted: includeSecrets ? [] : REDACTED_FIELDS, migrationVersions: snapshot.versions, attachmentKeys: snapshot.keys, files };
    await fs.writeFile(path.join(stagingPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await runTar(["-czf", outputPath, "-C", stagingPath, "manifest.json", snapshot.databaseName, "attachments"]);
    return manifest;
  } finally { await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {}); }
}

async function extractAndVerify(inputPath: string) {
  if (!(await exists(inputPath))) throw new BackupError(`Backup archive does not exist: ${inputPath}`);
  const listing = await runTar(["-tzf", inputPath]);
  const entries = listing.stdout.split("\n").map((line) => line.trim()).filter(Boolean).map(safeArchivePath);
  for (const entry of entries) if (entry !== "manifest.json" && entry !== "database.sqlite" && entry !== "database.json" && entry !== "attachments" && !entry.startsWith("attachments/")) throw new BackupError(`Unexpected archive entry: ${entry}`);
  const stagingPath = await fs.mkdtemp(path.join(os.tmpdir(), "taskforge-restore-"));
  try {
    await runTar(["-xzf", inputPath, "-C", stagingPath]);
    const manifestPath = path.join(stagingPath, "manifest.json");
    const manifestStat = await fs.lstat(manifestPath);
    if (!manifestStat.isFile()) throw new BackupError("Backup manifest is not a regular file");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as BackupManifest;
    if (manifest.formatVersion !== FORMAT_VERSION) throw new BackupError(`Unsupported backup format version: ${String(manifest.formatVersion)}`);
    if (!manifest.files || !Array.isArray(manifest.attachmentKeys)) throw new BackupError("Backup manifest is incomplete");
    validateVersions(manifest.migrationVersions ?? []);
    for (const [relative, expected] of Object.entries(manifest.files)) {
      const safe = safeArchivePath(relative);
      const actualPath = path.join(stagingPath, safe);
      if (!(await exists(actualPath))) throw new BackupError(`Backup file is missing: ${relative}`);
      const actual = await hashFile(actualPath);
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw new BackupError(`Checksum mismatch for ${relative}`);
    }
    for (const key of manifest.attachmentKeys) {
      const relative = `attachments/${safeKey(key)}`;
      if (!manifest.files[relative]) throw new BackupError(`Manifest is missing the attachment entry: ${key}`);
    }
    const databaseName = manifest.databaseDriver === "sqlite" ? "database.sqlite" : "database.json";
    if (!manifest.files[databaseName]) throw new BackupError(`Manifest is missing ${databaseName}`);
    return { stagingPath, manifest, databasePath: path.join(stagingPath, databaseName) };
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true });
    throw error instanceof BackupError ? error : new BackupError(`Invalid backup archive: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function stageAttachmentDirectory(stagingPath: string, attachmentsPath: string, keys: string[]) {
  const staged = `${attachmentsPath}.restore-${crypto.randomUUID()}`;
  await fs.mkdir(staged, { recursive: true });
  try {
    const sourceDirectory = path.join(stagingPath, "attachments");
    const directoryStat = await fs.lstat(sourceDirectory);
    if (!directoryStat.isDirectory()) throw new BackupError("Archive attachments entry is not a directory");
    for (const key of keys) {
      const source = path.join(sourceDirectory, safeKey(key));
      const sourceStat = await fs.lstat(source);
      if (!sourceStat.isFile()) throw new BackupError(`Archive attachment is not a regular file: ${key}`);
      await fs.copyFile(source, path.join(staged, safeKey(key)));
    }
    return staged;
  } catch (error) { await fs.rm(staged, { recursive: true, force: true }); throw error; }
}
async function swapDirectory(staged: string, destination: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const old = `${destination}.previous-${crypto.randomUUID()}`;
  const hadOld = await exists(destination);
  if (hadOld) await fs.rename(destination, old);
  try { await fs.rename(staged, destination); return { old, hadOld }; }
  catch (error) { if (hadOld) await fs.rename(old, destination); throw error; }
}
async function rollbackDirectory(destination: string, old: string, hadOld: boolean) {
  await fs.rm(destination, { recursive: true, force: true });
  if (hadOld) await fs.rename(old, destination);
}

async function restoreSqlite(databasePath: string, sourcePath: string, attachmentsPath: string, manifest: BackupManifest, stagingPath: string, force: boolean) {
  const inspect = new Sqlite(sourcePath, { readonly: true, fileMustExist: true });
  const versions = (inspect.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: string }>).map((row) => row.version);
  validateVersions(versions);
  const keys = (inspect.prepare("SELECT storage_key FROM task_attachments ORDER BY storage_key").all() as Array<{ storage_key: string }>).map((row) => row.storage_key);
  inspect.close();
  if (JSON.stringify(keys) !== JSON.stringify([...manifest.attachmentKeys].sort())) throw new BackupError("Attachment records do not match the backup manifest");
  if (!force && (await exists(databasePath) || await exists(attachmentsPath))) throw new BackupError("Restore target is not empty; pass --force to replace it");
  const targetDir = path.dirname(databasePath);
  await fs.mkdir(targetDir, { recursive: true });
  const stagedDb = path.join(targetDir, `.taskforge-restore-${crypto.randomUUID()}.db`);
  await fs.copyFile(sourcePath, stagedDb);
  const stagedAttachments = await stageAttachmentDirectory(stagingPath, attachmentsPath, manifest.attachmentKeys);
  const oldDb = `${databasePath}.previous-${crypto.randomUUID()}`;
  const hadDb = await exists(databasePath);
  let attachmentSwap: { old: string; hadOld: boolean } | undefined;
  try {
    if (hadDb) await fs.rename(databasePath, oldDb);
    await fs.rename(stagedDb, databasePath);
    attachmentSwap = await swapDirectory(stagedAttachments, attachmentsPath);
    // Keep the previous paths until the operator has verified the restore.
    // They are the recovery point if post-restore checks expose a problem.
  } catch (error) {
    await fs.rm(stagedDb, { force: true });
    if (attachmentSwap) await rollbackDirectory(attachmentsPath, attachmentSwap.old, attachmentSwap.hadOld);
    await fs.rm(databasePath, { force: true });
    if (hadDb) await fs.rename(oldDb, databasePath);
    throw new BackupError(`SQLite restore failed without retaining partial data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function restoreMysql(databaseUrl: string, sourcePath: string, attachmentsPath: string, manifest: BackupManifest, stagingPath: string, force: boolean) {
  const document = JSON.parse(await fs.readFile(sourcePath, "utf8")) as { formatVersion: number; tables: BackupTables };
  if (document.formatVersion !== FORMAT_VERSION || !document.tables) throw new BackupError("MySQL backup database payload is invalid");
  validateVersions(migrationVersions(document.tables));
  const keys = attachmentKeys(document.tables).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...manifest.attachmentKeys].sort())) throw new BackupError("Attachment records do not match the backup manifest");
  const adapter = createMysqlAdapter(databaseUrl);
  await runMigrations(adapter, "mysql");
  await adapter.close();
  const connection = await mysql.createConnection(databaseUrl);
  const existing = await connection.query("SELECT COUNT(*) AS count FROM users").then(([rows]) => Number((rows as Array<{ count: number }>)[0]?.count ?? 0));
  if (!force && existing > 0) { await connection.end(); throw new BackupError("Restore target is not empty; pass --force to replace it"); }
  const stagedAttachments = await stageAttachmentDirectory(stagingPath, attachmentsPath, manifest.attachmentKeys);
  let attachmentSwap: { old: string; hadOld: boolean } | undefined;
  try {
    attachmentSwap = await swapDirectory(stagedAttachments, attachmentsPath);
    await connection.beginTransaction();
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of [...TABLES].reverse()) await connection.query(`DELETE FROM \`${table}\``);
    for (const table of TABLES) {
      const rows = document.tables[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length) continue;
        const quoted = columns.map((column) => `\`${column.replaceAll("`", "``")}\``).join(", ");
        await connection.query(`INSERT INTO \`${table}\` (${quoted}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column]));
      }
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.commit();
    // Keep the previous attachment directory until the operator has verified
    // the restore, matching the SQLite recovery behavior above.
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (attachmentSwap) await rollbackDirectory(attachmentsPath, attachmentSwap.old, attachmentSwap.hadOld);
    throw new BackupError(`MySQL restore failed without retaining partial data: ${error instanceof Error ? error.message : String(error)}`);
  } finally { await connection.end(); }
}

export async function restoreBackup(options: RestoreOptions) {
  const extracted = await extractAndVerify(path.resolve(options.inputPath));
  try {
    const driver = driverOf(options.databaseDriver);
    if (extracted.manifest.databaseDriver !== driver) throw new BackupError(`Backup driver ${extracted.manifest.databaseDriver} does not match restore driver ${driver}`);
    const attachmentsPath = attachmentsOf(options.attachmentsPath);
    if (driver === "sqlite") await restoreSqlite(path.resolve(options.databasePath ?? config.databasePath), extracted.databasePath, attachmentsPath, extracted.manifest, extracted.stagingPath, options.force === true);
    else await restoreMysql(options.databaseUrl ?? config.databaseUrl!, extracted.databasePath, attachmentsPath, extracted.manifest, extracted.stagingPath, options.force === true);
    return extracted.manifest;
  } finally { await fs.rm(extracted.stagingPath, { recursive: true, force: true }).catch(() => {}); }
}

function parseCli(args: string[]) {
  const command = args.shift();
  const values = new Map<string, string>();
  let includeSecrets = false;
  let force = false;
  while (args.length) {
    const value = args.shift()!;
    if (value === "--include-secrets") includeSecrets = true;
    else if (value === "--force") force = true;
    else if (value.startsWith("--") && args.length) values.set(value.slice(2), args.shift()!);
    else throw new BackupError(`Unknown backup option: ${value}`);
  }
  if (!command || !values.get(command === "create" ? "output" : "input")) throw new BackupError(`Usage: ${command === "create" ? "backup create --output FILE [--include-secrets]" : "backup restore --input FILE --force"}`);
  return { command, values, includeSecrets, force };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const parsed = parseCli(process.argv.slice(2));
    const result = parsed.command === "create"
      ? await createBackup({ outputPath: parsed.values.get("output")!, includeSecrets: parsed.includeSecrets })
      : await restoreBackup({ inputPath: parsed.values.get("input")!, force: parsed.force });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
