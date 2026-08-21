import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";

const legacyMysqlUrl = process.env.TEST_LEGACY_DATABASE_URL;
const testDir = mkdtempSync(path.join(tmpdir(), "taskforge-workflow-migration-"));
const sqlitePath = path.join(testDir, "legacy.db");
const ownerId = "10000000-0000-4000-8000-000000000001";
const projectId = "10000000-0000-4000-8000-000000000002";
const taskId = "10000000-0000-4000-8000-000000000003";
const now = "2026-08-20T00:00:00.000Z";

if (legacyMysqlUrl) {
  const connection = await mysql.createConnection(legacyMysqlUrl);
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of ["automations", "task_attachments", "task_updates", "notifications", "activity", "task_dependencies", "task_tags", "tags", "tasks", "phases", "project_members", "project_statuses", "workflow_template_statuses", "workflow_templates", "projects", "api_tokens", "users", "schema_migrations"]) await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  await connection.query("CREATE TABLE users (id CHAR(36) PRIMARY KEY, email VARCHAR(320), name VARCHAR(120) NOT NULL, password_hash VARCHAR(255), kind VARCHAR(16) NOT NULL, role VARCHAR(16) NOT NULL, avatar_url TEXT, created_at VARCHAR(30) NOT NULL) ENGINE=InnoDB");
  await connection.query("CREATE TABLE projects (id CHAR(36) PRIMARY KEY, `key` VARCHAR(8) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, description TEXT NOT NULL, color CHAR(7) NOT NULL, owner_id CHAR(36) NOT NULL, next_task_number INT NOT NULL DEFAULT 1, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL) ENGINE=InnoDB");
  await connection.query("CREATE TABLE tasks (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, title VARCHAR(240) NOT NULL, description TEXT NOT NULL, definition_of_done TEXT NOT NULL, status VARCHAR(20) NOT NULL CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')), priority VARCHAR(16) NOT NULL, assignee_id CHAR(36), creator_id CHAR(36) NOT NULL, parent_id CHAR(36), branch VARCHAR(255), due_date VARCHAR(10), estimate_points INT, position INT NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_task_number (project_id, number)) ENGINE=InnoDB");
  await connection.execute("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'HUMAN', 'ADMIN', ?)", [ownerId, "legacy@example.test", "Legacy Owner", now]);
  await connection.execute("INSERT INTO projects (id, `key`, name, description, color, owner_id, created_at, updated_at) VALUES (?, 'LEG', 'Legacy project', '', '#6554C0', ?, ?, ?)", [projectId, ownerId, now, now]);
  await connection.execute("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, creator_id, position, created_at, updated_at) VALUES (?, ?, 1, 'Legacy task', '', '', 'IN_REVIEW', 'MEDIUM', ?, 0, ?, ?)", [taskId, projectId, ownerId, now, now]);
  await connection.end();
  process.env.DATABASE_DRIVER = "mysql";
  process.env.DATABASE_URL = legacyMysqlUrl;
} else {
  const sqlite = new Sqlite(sqlitePath);
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT NOT NULL, password_hash TEXT, kind TEXT NOT NULL, role TEXT NOT NULL, avatar_url TEXT, created_at TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, owner_id TEXT NOT NULL, next_task_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')), priority TEXT NOT NULL, assignee_id TEXT, creator_id TEXT NOT NULL, parent_id TEXT, branch TEXT, due_date TEXT, estimate_points INTEGER, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number));
  `);
  sqlite.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'HUMAN', 'ADMIN', ?)").run(ownerId, "legacy@example.test", "Legacy Owner", now);
  sqlite.prepare("INSERT INTO projects (id, key, name, color, owner_id, created_at, updated_at) VALUES (?, 'LEG', 'Legacy project', '#6554C0', ?, ?, ?)").run(projectId, ownerId, now, now);
  sqlite.prepare("INSERT INTO tasks (id, project_id, number, title, status, priority, creator_id, created_at, updated_at) VALUES (?, ?, 1, 'Legacy task', 'IN_REVIEW', 'MEDIUM', ?, ?, ?)").run(taskId, projectId, ownerId, now, now);
  sqlite.close();
  process.env.DATABASE_DRIVER = "sqlite";
  process.env.DATABASE_PATH = sqlitePath;
  delete process.env.DATABASE_URL;
}

const { Database, db } = await import("../src/db/database.js");
let activeDatabase = db;

after(async () => {
  await activeDatabase.close();
  rmSync(testDir, { recursive: true, force: true });
});

test(`workflow storage upgrades a legacy ${legacyMysqlUrl ? "MySQL" : "SQLite"} database idempotently`, async () => {
  const statuses = await activeDatabase.prepare("SELECT `key`, category, position FROM project_statuses WHERE project_id = ? ORDER BY position").all(projectId);
  assert.deepEqual(statuses, [
    { key: "BACKLOG", category: "NOT_STARTED", position: 0 },
    { key: "TODO", category: "NOT_STARTED", position: 1 },
    { key: "IN_PROGRESS", category: "ACTIVE", position: 2 },
    { key: "IN_REVIEW", category: "ACTIVE", position: 3 },
    { key: "DONE", category: "COMPLETED", position: 4 },
  ]);
  const task = await activeDatabase.prepare("SELECT status, status_id FROM tasks WHERE id = ?").get(taskId);
  const reviewStatus = await activeDatabase.prepare("SELECT id FROM project_statuses WHERE project_id = ? AND `key` = 'IN_REVIEW'").get(projectId);
  assert.deepEqual(task, { status: "IN_REVIEW", status_id: reviewStatus?.id });
  assert.equal(Number((await activeDatabase.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status_id IS NULL").get<{ count: number }>())?.count), 0);
  assert.equal(Number((await activeDatabase.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20260821_workflow_status_storage'").get<{ count: number }>())?.count), 1);
  await assert.rejects(() => activeDatabase.prepare("UPDATE tasks SET status = 'CUSTOM' WHERE id = ?").run(taskId), "the legacy five-value constraint must remain active");

  await activeDatabase.prepare("DELETE FROM schema_migrations WHERE version = '20260821_workflow_status_storage'").run();
  await activeDatabase.prepare("DELETE FROM project_statuses WHERE project_id = ? AND `key` != 'IN_REVIEW'").run(projectId);
  await activeDatabase.close();
  activeDatabase = new Database();
  assert.equal(Number((await activeDatabase.prepare("SELECT COUNT(*) AS count FROM project_statuses WHERE project_id = ?").get<{ count: number }>(projectId))?.count), 5);
  assert.equal(Number((await activeDatabase.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '20260821_workflow_status_storage'").get<{ count: number }>())?.count), 1);
});
