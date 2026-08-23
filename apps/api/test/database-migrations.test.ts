import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import mysql from "mysql2/promise";

const testRoot = mkdtempSync(path.join(tmpdir(), "taskforge-versioned-migrations-"));
process.env.DATABASE_DRIVER = "sqlite";
process.env.DATABASE_PATH = path.join(testRoot, "module-bootstrap.db");
process.env.JWT_SECRET = "test-secret-at-least-long-enough";
process.env.TEST = "1";

const databaseModule = await import("../src/db/database.js");
const {
  LEGACY_MIGRATION_VERSIONS,
  createMysqlAdapter,
  createSqliteAdapter,
  db,
  migrations,
  runMigrations,
} = databaseModule;
type Adapter = import("../src/db/database.js").Adapter;
type DatabaseDriver = import("../src/db/database.js").DatabaseDriver;

after(async () => {
  await db.close();
  rmSync(testRoot, { recursive: true, force: true });
});

const mysqlTestUrl = process.env.TEST_DATABASE_URL;

async function createFixtureDatabase(driver: DatabaseDriver) {
  if (driver === "sqlite") {
    const databasePath = path.join(testRoot, `${crypto.randomUUID()}.db`);
    return { adapter: createSqliteAdapter(databasePath), createPeer: () => createSqliteAdapter(databasePath), cleanup: async () => {} };
  }

  if (!mysqlTestUrl) throw new Error("TEST_DATABASE_URL is required for MySQL migration fixtures");
  const databaseName = `taskforge_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(mysqlTestUrl);
  adminUrl.pathname = "/";
  const admin = await mysql.createConnection(adminUrl.toString());
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const fixtureUrl = new URL(mysqlTestUrl);
  fixtureUrl.pathname = `/${databaseName}`;
  const adapter = createMysqlAdapter(fixtureUrl.toString());
  return {
    adapter,
    createPeer: () => createMysqlAdapter(fixtureUrl.toString()),
    cleanup: async () => {
      await adapter.close();
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    },
  };
}

async function withFixture(driver: DatabaseDriver, callback: (adapter: Adapter) => Promise<void>) {
  const fixture = await createFixtureDatabase(driver);
  try {
    await callback(fixture.adapter);
  } finally {
    if (driver === "sqlite") await fixture.adapter.close();
    await fixture.cleanup();
  }
}

const legacyStatuses = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
const currentStatuses = ["BACKLOG", "REFINING", "TODO", "READY_FOR_DEV", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "DONE", "CANCELLED"];

async function createLegacyFixture(adapter: Adapter, driver: DatabaseDriver, markerEra = false, invalidStatus = false) {
  const statuses = markerEra ? currentStatuses : legacyStatuses;
  const check = invalidStatus ? "" : ` CHECK (status IN (${statuses.map((status) => `'${status}'`).join(", ")}))`;
  if (driver === "sqlite") {
    await adapter.run("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT, kind TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'MEMBER', avatar_url TEXT, created_at TEXT NOT NULL)", []);
    await adapter.run("CREATE TABLE projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', repo_url TEXT, color TEXT NOT NULL DEFAULT '#6554C0', owner_id TEXT NOT NULL REFERENCES users(id), next_task_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", []);
    await adapter.run(`CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'TODO'${check}, priority TEXT NOT NULL DEFAULT 'MEDIUM', assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, branch TEXT, due_date TEXT, estimate_points INTEGER, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`, []);
  } else {
    await adapter.run("CREATE TABLE users (id CHAR(36) PRIMARY KEY, email VARCHAR(320) UNIQUE, name VARCHAR(120) NOT NULL, password_hash VARCHAR(255), kind VARCHAR(16) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'MEMBER', avatar_url TEXT, created_at VARCHAR(30) NOT NULL) ENGINE=InnoDB", []);
    await adapter.run("CREATE TABLE projects (id CHAR(36) PRIMARY KEY, `key` VARCHAR(8) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, description TEXT NOT NULL, repo_url TEXT, color CHAR(7) NOT NULL DEFAULT '#6554C0', owner_id CHAR(36) NOT NULL, next_task_number INT NOT NULL DEFAULT 1, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB", []);
    await adapter.run(`CREATE TABLE tasks (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, title VARCHAR(240) NOT NULL, description TEXT NOT NULL, definition_of_done TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'TODO'${check}, priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM', assignee_id CHAR(36), creator_id CHAR(36) NOT NULL, parent_id CHAR(36), branch VARCHAR(255), due_date VARCHAR(10), estimate_points INT, position INT NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_task_number (project_id, number), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (creator_id) REFERENCES users(id)) ENGINE=InnoDB`, []);
  }

  await adapter.run("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["user-1", "owner@example.test", "Owner", "HUMAN", "ADMIN", "2026-01-01T00:00:00.000Z"]);
  await adapter.run("INSERT INTO projects (id, `key`, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["project-1", "LEG", "Legacy project", "", "user-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  await adapter.run("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["task-1", "project-1", 1, "Legacy task", "", "", invalidStatus ? "CUSTOM_UNKNOWN" : "TODO", "user-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  if (invalidStatus) {
    await adapter.run("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["task-2", "project-1", 2, "Second invalid task", "", "", "ANOTHER_UNKNOWN", "user-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  }

  if (markerEra) {
    await adapter.run("CREATE TABLE schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(30) NOT NULL)", []);
    await adapter.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [LEGACY_MIGRATION_VERSIONS[0], "2026-08-22T00:00:00.000Z"]);
  }
}

async function assertCurrentSchema(adapter: Adapter, driver: DatabaseDriver, expectsLegacyTask: boolean) {
  const applied = await adapter.all<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version", []);
  for (const migration of migrations) assert.ok(applied.some((row) => row.version === migration.version), `${migration.version} was not recorded`);
  if (expectsLegacyTask) {
    assert.equal((await adapter.get<{ title: string }>("SELECT title FROM tasks WHERE id = ?", ["task-1"]))?.title, "Legacy task");
    const project = await adapter.get<{ available_statuses: string; default_status: string }>("SELECT available_statuses, default_status FROM projects WHERE id = ?", ["project-1"]);
    assert.deepEqual(JSON.parse(project!.available_statuses), currentStatuses);
    assert.equal(project!.default_status, "TODO");
    await adapter.run("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["task-2", "project-1", 2, "Post-migration task", "", "", "READY_FOR_REVIEW", "user-1", "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]);
  }
  const hasWebhookTable = driver === "sqlite"
    ? Boolean(await adapter.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'webhook_deliveries'", []))
    : Boolean(await adapter.get("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'", []));
  assert.equal(hasWebhookTable, true);
  const hasPageIndex = driver === "sqlite"
    ? (await adapter.all<{ name: string }>("PRAGMA index_list(tasks)", [])).some((row) => row.name === "idx_tasks_project_page")
    : Boolean(await adapter.get("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'tasks' AND index_name = 'idx_tasks_project_page'", []));
  assert.equal(hasPageIndex, true);
}

for (const driver of ["sqlite", "mysql"] as const) {
  if (driver === "mysql") {
    test("concurrent MySQL startup converges on one ordered ledger", { skip: !mysqlTestUrl }, async () => {
      const fixture = await createFixtureDatabase(driver);
      const peer = fixture.createPeer();
      try {
        await Promise.all([runMigrations(fixture.adapter, driver), runMigrations(peer, driver)]);
        assert.equal((await fixture.adapter.all("SELECT version FROM schema_migrations", [])).length, migrations.length);
      } finally {
        await peer.close();
        await fixture.cleanup();
      }
    });
  }

  test(`fresh installs and supported legacy fixtures migrate deterministically on ${driver}`, { skip: driver === "mysql" && !mysqlTestUrl }, async (t) => {
    await t.test("fresh install", async () => {
      await withFixture(driver, async (adapter) => {
        await runMigrations(adapter, driver);
        await assertCurrentSchema(adapter, driver, false);
        await runMigrations(adapter, driver);
        assert.equal((await adapter.all("SELECT version FROM schema_migrations", [])).length, migrations.length);
      });
    });

    for (const [name, markerEra] of [["pre-ledger five-status schema", false], ["20260822 marker-era schema", true]] as const) {
      await t.test(name, async () => {
        await withFixture(driver, async (adapter) => {
          await createLegacyFixture(adapter, driver, markerEra);
          await runMigrations(adapter, driver);
          await assertCurrentSchema(adapter, driver, true);
          const expectedLedgerSize = migrations.length + (markerEra ? 1 : 0);
          assert.equal((await adapter.all("SELECT version FROM schema_migrations", [])).length, expectedLedgerSize);
        });
      });
    }
  });

  test(`unsafe and inconsistent migration states fail safely on ${driver}`, { skip: driver === "mysql" && !mysqlTestUrl }, async (t) => {
    await t.test("a migration failure never writes its ledger entry", async () => {
      await withFixture(driver, async (adapter) => {
        const failingMigration: import("../src/db/database.js").Migration = {
          version: "test_partial_failure",
          async up(executor) {
            await executor.run("CREATE TABLE partial_migration_work (id VARCHAR(36) PRIMARY KEY)", []);
            throw new Error("injected migration failure");
          },
        };
        await assert.rejects(runMigrations(adapter, driver, [failingMigration]), /injected migration failure/);
        assert.equal(await adapter.get("SELECT 1 FROM schema_migrations WHERE version = ?", [failingMigration.version]), undefined);
      });
    });

    await t.test("destructive preflight reports every offending row and is not marked applied", async () => {
      await withFixture(driver, async (adapter) => {
        await createLegacyFixture(adapter, driver, false, true);
        await assert.rejects(runMigrations(adapter, driver), (error: Error) => {
          assert.match(error.message, /0003_expand_task_statuses/);
          assert.match(error.message, /task_id=task-1, project_id=project-1, status=CUSTOM_UNKNOWN/);
          assert.match(error.message, /task_id=task-2, project_id=project-1, status=ANOTHER_UNKNOWN/);
          return true;
        });
        assert.equal(await adapter.get("SELECT 1 FROM schema_migrations WHERE version = ?", ["0003_expand_task_statuses"]), undefined);
      });
    });

    await t.test("unknown migration version", async () => {
      await withFixture(driver, async (adapter) => {
        await adapter.run("CREATE TABLE schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(30) NOT NULL)", []);
        await adapter.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", ["9999_unknown", "2026-01-01T00:00:00.000Z"]);
        await assert.rejects(runMigrations(adapter, driver), /unknown migration version.*9999_unknown/i);
      });
    });

    await t.test("non-contiguous migration history", async () => {
      await withFixture(driver, async (adapter) => {
        await adapter.run("CREATE TABLE schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(30) NOT NULL)", []);
        await adapter.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [migrations[0]!.version, "2026-01-01T00:00:00.000Z"]);
        await adapter.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [migrations[2]!.version, "2026-01-01T00:00:00.000Z"]);
        await assert.rejects(runMigrations(adapter, driver), /inconsistent.*missing 0002_legacy_columns/i);
      });
    });
  });
}
