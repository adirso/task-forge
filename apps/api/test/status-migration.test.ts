import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Sqlite from "better-sqlite3";

const testDir = mkdtempSync(path.join(tmpdir(), "taskforge-status-migration-"));
const databasePath = path.join(testDir, "legacy.db");
const legacy = new Sqlite(databasePath);
legacy.pragma("foreign_keys = ON");
legacy.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT, kind TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'MEMBER', avatar_url TEXT, webhook_url TEXT, created_at TEXT NOT NULL);
  CREATE TABLE projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', repo_url TEXT, color TEXT NOT NULL DEFAULT '#6554C0', sort_order INTEGER NOT NULL DEFAULT 0, available_statuses TEXT NOT NULL DEFAULT '["BACKLOG","TODO","IN_PROGRESS","IN_REVIEW","DONE"]', default_status TEXT NOT NULL DEFAULT 'TODO', owner_id TEXT NOT NULL REFERENCES users(id), next_task_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE phases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, goal TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number));
  CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')), priority TEXT NOT NULL DEFAULT 'MEDIUM', type TEXT NOT NULL DEFAULT 'FEATURE', assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, branch TEXT, due_date TEXT, estimate_points INTEGER, phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL, pull_request_url TEXT, pull_request_title TEXT, pull_request_state TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number));
  CREATE TABLE task_updates (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  INSERT INTO users (id, email, name, kind, role, created_at) VALUES ('user-1', 'owner@example.test', 'Owner', 'HUMAN', 'ADMIN', '2026-01-01T00:00:00.000Z');
  INSERT INTO projects (id, key, name, owner_id, created_at, updated_at) VALUES ('project-1', 'LEG', 'Legacy project', 'user-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  INSERT INTO tasks (id, project_id, number, title, status, creator_id, created_at, updated_at) VALUES ('task-1', 'project-1', 1, 'Legacy task', 'TODO', 'user-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES ('update-1', 'task-1', 'user-1', 'Keep this note', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`);
legacy.close();

process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "test-secret-at-least-long-enough";
process.env.TEST = "1";

const { db } = await import("../src/db/database.js");

after(async () => {
  await db.close();
  rmSync(testDir, { recursive: true, force: true });
});

test("legacy SQLite status checks migrate without losing tasks", async () => {
  const project = await db.prepare("SELECT available_statuses, default_status FROM projects WHERE id = ?").get("project-1");
  assert.deepEqual(JSON.parse(String(project?.available_statuses)), ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "DONE", "CANCELLED"]);
  assert.equal(project?.default_status, "TODO");
  assert.equal((await db.prepare("SELECT title FROM tasks WHERE id = ?").get("task-1"))?.title, "Legacy task");
  assert.equal((await db.prepare("SELECT body FROM task_updates WHERE task_id = ?").get("task-1"))?.body, "Keep this note");

  await db.prepare("INSERT INTO tasks (id, project_id, number, title, status, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("task-2", "project-1", 2, "New status task", "READY_FOR_REVIEW", "user-1", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  assert.equal((await db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-2"))?.status, "READY_FOR_REVIEW");
  await db.prepare("INSERT INTO tasks (id, project_id, number, title, status, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("task-3", "project-1", 3, "Fix status task", "FIX_IN_PROGRESS", "user-1", "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z");
  assert.equal((await db.prepare("SELECT status FROM tasks WHERE id = ?").get("task-3"))?.status, "FIX_IN_PROGRESS");
  const taskIndexes = new Set((await db.prepare("PRAGMA index_list(tasks)").all()).map((index) => String(index.name)));
  const updateIndexes = new Set((await db.prepare("PRAGMA index_list(task_updates)").all()).map((index) => String(index.name)));
  assert.ok(taskIndexes.has("idx_tasks_project_page"));
  assert.ok(taskIndexes.has("idx_tasks_updated_page"));
  assert.ok(updateIndexes.has("idx_task_updates_task_page"));
  assert.equal(await db.prepare("PRAGMA foreign_key_check").get(), undefined);
});
