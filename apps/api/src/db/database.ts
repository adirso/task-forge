import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import Sqlite from "better-sqlite3";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { DEFAULT_PROJECT_STATUSES, TASK_STATUSES } from "@taskforge/contracts";
import { config } from "../config.js";

export type DatabaseDriver = "sqlite" | "mysql";
export type Row = Record<string, unknown>;
export type RunResult = { changes: number };

export interface Executor {
  get<T extends Row>(sql: string, params: unknown[]): Promise<T | undefined>;
  all<T extends Row>(sql: string, params: unknown[]): Promise<T[]>;
  run(sql: string, params: unknown[]): Promise<RunResult>;
}

export interface Adapter extends Executor {
  transaction<T>(callback: (executor: Executor) => Promise<T>, options?: { immediate?: boolean }): Promise<T>;
  withMigrationLock<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function mysqlSql(sql: string) {
  return sql
    .replace(/INSERT OR IGNORE/gi, "INSERT IGNORE")
    .replace(/ COLLATE NOCASE/gi, "")
    .replace(/ON CONFLICT\(project_id, user_id\) DO UPDATE SET role = excluded\.role/gi, "ON DUPLICATE KEY UPDATE role = VALUES(role)");
}

function mysqlExecutor(connection: Pool | PoolConnection): Executor {
  const executor: Executor = {
    get: async <T extends Row>(sql: string, params: unknown[]): Promise<T | undefined> => {
      const [rows] = await connection.execute(mysqlSql(sql), params as never[]);
      return (rows as T[])[0];
    },
    all: async <T extends Row>(sql: string, params: unknown[]): Promise<T[]> => {
      const [rows] = await connection.execute(mysqlSql(sql), params as never[]);
      return rows as T[];
    },
    run: async (sql: string, params: unknown[]) => {
      const [result] = await connection.execute(mysqlSql(sql), params as never[]);
      return { changes: (result as ResultSetHeader).affectedRows ?? 0 };
    },
  };
  return executor;
}

export function createMysqlAdapter(url: string): Adapter {
  const pool = mysql.createPool({ uri: url, connectionLimit: 10, charset: "utf8mb4" });
  const executor = mysqlExecutor(pool);
  return {
    ...executor,
    async transaction<T>(callback: (transactionExecutor: Executor) => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await callback(mysqlExecutor(connection));
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async withMigrationLock<T>(callback: () => Promise<T>) {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.execute("SELECT GET_LOCK(CONCAT('taskforge:', LEFT(SHA2(DATABASE(), 256), 48)), 30) AS acquired");
        if (Number((rows as Array<{ acquired: number }>)[0]?.acquired) !== 1) throw new Error("Timed out waiting for the TaskForge database migration lock");
        return await callback();
      } finally {
        await connection.execute("SELECT RELEASE_LOCK(CONCAT('taskforge:', LEFT(SHA2(DATABASE(), 256), 48)))");
        connection.release();
      }
    },
    async close() { await pool.end(); },
  };
}

export function createSqliteAdapter(databasePath: string): Adapter {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Sqlite(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const directExecutor: Executor = {
    async get<T extends Row>(sql: string, params: unknown[]) { return sqlite.prepare(sql).get(...params) as T | undefined; },
    async all<T extends Row>(sql: string, params: unknown[]) { return sqlite.prepare(sql).all(...params) as T[]; },
    async run(sql: string, params: unknown[]) { return { changes: sqlite.prepare(sql).run(...params).changes }; },
  };
  let queuedTransactions = 0;
  let transactionQueue = Promise.resolve();

  async function waitForTransactions() {
    if (queuedTransactions > 0) await transactionQueue;
  }

  return {
    async get<T extends Row>(sql: string, params: unknown[]) { await waitForTransactions(); return directExecutor.get<T>(sql, params); },
    async all<T extends Row>(sql: string, params: unknown[]) { await waitForTransactions(); return directExecutor.all<T>(sql, params); },
    async run(sql: string, params: unknown[]) { await waitForTransactions(); return directExecutor.run(sql, params); },
    async transaction<T>(callback: (transactionExecutor: Executor) => Promise<T>, options?: { immediate?: boolean }) {
      const previous = transactionQueue;
      let release = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      transactionQueue = previous.then(() => gate);
      queuedTransactions += 1;
      await previous;
      try {
        sqlite.exec(options?.immediate ? "BEGIN IMMEDIATE" : "BEGIN");
        const result = await callback(directExecutor);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        queuedTransactions -= 1;
        release();
      }
    },
    async withMigrationLock<T>(callback: () => Promise<T>) { return callback(); },
    async close() { sqlite.close(); },
  };
}

class Database {
  readonly dialect: DatabaseDriver;
  private readonly adapter: Adapter;
  private readonly context = new AsyncLocalStorage<Executor>();
  private readonly ready: Promise<void>;

  constructor() {
    this.dialect = config.databaseDriver;
    this.adapter = this.dialect === "mysql" ? createMysqlAdapter(config.databaseUrl!) : createSqliteAdapter(config.databasePath);
    this.ready = runMigrations(this.adapter, this.dialect);
  }

  prepare(sql: string) {
    return {
      get: async <T extends Row = Row>(...params: unknown[]) => { await this.ready; return (this.context.getStore() ?? this.adapter).get<T>(sql, params); },
      all: async <T extends Row = Row>(...params: unknown[]) => { await this.ready; return (this.context.getStore() ?? this.adapter).all<T>(sql, params); },
      run: async (...params: unknown[]) => { await this.ready; return (this.context.getStore() ?? this.adapter).run(sql, params); },
    };
  }

  transaction<T>(callback: () => Promise<T>) {
    return async () => {
      await this.ready;
      return this.adapter.transaction((executor) => this.context.run(executor, callback));
    };
  }

  async close() {
    try {
      await this.ready;
    } finally {
      await this.adapter.close();
    }
  }
}

async function runStatements(executor: Executor, statements: string[]) {
  for (const statement of statements) await executor.run(statement, []);
}

const taskStatusSql = TASK_STATUSES.map((status) => `'${status}'`).join(", ");
const legacyTaskStatusSql = [...TASK_STATUSES.slice(0, 3), "READY_FOR_DEV", ...TASK_STATUSES.slice(3)].map((status) => `'${status}'`).join(", ");
const defaultAvailableStatuses = JSON.stringify(DEFAULT_PROJECT_STATUSES);
const legacyDefaultAvailableStatuses = defaultAvailableStatuses;
const legacyAvailableStatuses = JSON.stringify(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);

const sqliteSchema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT, kind TEXT NOT NULL CHECK (kind IN ('HUMAN', 'AGENT')), role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')), avatar_url TEXT, webhook_url TEXT, webhook_secret_ciphertext TEXT, webhook_secret_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_ciphertext TEXT, permissions TEXT, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', repo_url TEXT, color TEXT NOT NULL DEFAULT '#6554C0', sort_order INTEGER NOT NULL DEFAULT 0, available_statuses TEXT NOT NULL DEFAULT '${defaultAvailableStatuses}', default_status TEXT NOT NULL DEFAULT 'TODO', owner_id TEXT NOT NULL REFERENCES users(id), next_task_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')), created_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS phases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, goal TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_phases_one_active ON phases(project_id) WHERE is_active = 1`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN (${taskStatusSql})), priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')), type TEXT NOT NULL DEFAULT 'FEATURE' CHECK (type IN ('FEATURE', 'BUG', 'INFRA', 'UPDATE', 'SECURITY', 'DOCS', 'CHORE')), assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, branch TEXT, due_date TEXT, estimate_points INTEGER, phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL, pull_request_url TEXT, pull_request_title TEXT, pull_request_state TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project_page ON tasks(project_id, status, position, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_updated_page ON tasks(updated_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)`,
  `CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL, UNIQUE (project_id, name))`,
  `CREATE TABLE IF NOT EXISTS task_tags (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (task_id, tag_id))`,
  `CREATE INDEX IF NOT EXISTS idx_task_tags_tag_task ON task_tags(tag_id, task_id)`,
  `CREATE TABLE IF NOT EXISTS task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (task_id, depends_on_task_id), CHECK (task_id <> depends_on_task_id))`,
  `CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependency ON task_dependencies(depends_on_task_id, task_id)`,
  `CREATE TABLE IF NOT EXISTS task_status_history (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, status TEXT NOT NULL, entered_at TEXT NOT NULL, exited_at TEXT, duration_seconds INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_task_status_history_task ON task_status_history(task_id, entered_at, id)`,
  `CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_project_page ON activity(project_id, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_task_page ON activity(task_id, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_actor_page ON activity(actor_id, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS security_audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'throttled')), ip_address TEXT NOT NULL, account TEXT, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_events(created_at, id)`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', read_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_page ON notifications(user_id, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS task_updates (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_task_updates_task_created ON task_updates(task_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_updates_task_page ON task_updates(task_id, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, uploaded_by_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_task_attachments_task_created ON task_attachments(task_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, \`trigger\` TEXT NOT NULL, actor_type TEXT NOT NULL DEFAULT 'ANY', actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, service TEXT, conditions TEXT NOT NULL, actions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id, enabled)`,
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, event_type TEXT NOT NULL CHECK (event_type IN ('task.assigned', 'task.update_added', 'task.status_changed')), payload TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('PENDING', 'RETRYING', 'DELIVERED', 'FAILED')), attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, locked_until TEXT, last_attempt_at TEXT, delivered_at TEXT, failed_at TEXT, last_error TEXT, http_status INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at, locked_until)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_agent ON webhook_deliveries(agent_id, created_at)`,
];

const mysqlSchema = [
  `CREATE TABLE IF NOT EXISTS users (id CHAR(36) PRIMARY KEY, email VARCHAR(320) UNIQUE, name VARCHAR(120) NOT NULL, password_hash VARCHAR(255), kind VARCHAR(16) NOT NULL CHECK (kind IN ('HUMAN', 'AGENT')), role VARCHAR(16) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')), avatar_url TEXT, webhook_url TEXT, webhook_secret_ciphertext TEXT, webhook_secret_version INT NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS api_tokens (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, token_prefix VARCHAR(32) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, token_ciphertext TEXT, permissions TEXT, expires_at VARCHAR(30), last_used_at VARCHAR(30), revoked_at VARCHAR(30), created_at VARCHAR(30) NOT NULL, INDEX idx_api_tokens_hash (token_hash), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS projects (id CHAR(36) PRIMARY KEY, \`key\` VARCHAR(8) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, description TEXT NOT NULL, repo_url TEXT, color CHAR(7) NOT NULL DEFAULT '#6554C0', sort_order INT NOT NULL DEFAULT 0, available_statuses VARCHAR(255) NOT NULL DEFAULT '${defaultAvailableStatuses}', default_status VARCHAR(20) NOT NULL DEFAULT 'TODO', owner_id CHAR(36) NOT NULL, next_task_number INT NOT NULL DEFAULT 1, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_projects_sort_order (sort_order), FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS project_members (project_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')), created_at VARCHAR(30) NOT NULL, PRIMARY KEY (project_id, user_id), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS phases (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, goal TEXT NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_phase_number (project_id, number), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tasks (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, title VARCHAR(240) NOT NULL, description TEXT NOT NULL, definition_of_done TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'TODO' CHECK (status IN (${taskStatusSql})), priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')), type VARCHAR(16) NOT NULL DEFAULT 'FEATURE' CHECK (type IN ('FEATURE', 'BUG', 'INFRA', 'UPDATE', 'SECURITY', 'DOCS', 'CHORE')), assignee_id CHAR(36), creator_id CHAR(36) NOT NULL, parent_id CHAR(36), branch VARCHAR(255), due_date VARCHAR(10), estimate_points INT, phase_id CHAR(36), pull_request_url TEXT, pull_request_title VARCHAR(240), pull_request_state VARCHAR(16), position INT NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_task_number (project_id, number), INDEX idx_tasks_project_status (project_id, status, position), INDEX idx_tasks_project_page (project_id, status, position, created_at, id), INDEX idx_tasks_updated_page (updated_at, id), INDEX idx_tasks_parent (parent_id), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (creator_id) REFERENCES users(id), FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tags (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(32) NOT NULL, created_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_tag_name (project_id, name), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_tags (task_id CHAR(36) NOT NULL, tag_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, PRIMARY KEY (task_id, tag_id), INDEX idx_task_tags_tag_task (tag_id, task_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_dependencies (task_id CHAR(36) NOT NULL, depends_on_task_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, PRIMARY KEY (task_id, depends_on_task_id), INDEX idx_task_dependencies_dependency (depends_on_task_id, task_id), CHECK (task_id <> depends_on_task_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_status_history (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, status VARCHAR(32) NOT NULL, entered_at VARCHAR(30) NOT NULL, exited_at VARCHAR(30), duration_seconds INT, INDEX idx_task_status_history_task (task_id, entered_at, id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS activity (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, task_id CHAR(36), actor_id CHAR(36) NOT NULL, action VARCHAR(80) NOT NULL, metadata TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, INDEX idx_activity_project_page (project_id, created_at, id), INDEX idx_activity_task_page (task_id, created_at, id), INDEX idx_activity_actor_page (actor_id, created_at, id), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (actor_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS security_audit_events (id CHAR(36) PRIMARY KEY, action VARCHAR(80) NOT NULL, outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'failure', 'throttled')), ip_address VARCHAR(160) NOT NULL, account VARCHAR(320), user_id CHAR(36), created_at VARCHAR(30) NOT NULL, INDEX idx_security_audit_created (created_at, id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS notifications (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, project_id CHAR(36), task_id CHAR(36), type VARCHAR(60) NOT NULL, title VARCHAR(240) NOT NULL, message TEXT NOT NULL, read_at VARCHAR(30), created_at VARCHAR(30) NOT NULL, INDEX idx_notifications_user_unread (user_id, read_at, created_at), INDEX idx_notifications_user_page (user_id, created_at, id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_updates (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, author_id CHAR(36) NOT NULL, body TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_task_updates_task_created (task_id, created_at), INDEX idx_task_updates_task_page (task_id, created_at, id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_attachments (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(160) NOT NULL, file_size BIGINT NOT NULL, storage_key VARCHAR(255) NOT NULL UNIQUE, uploaded_by_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, INDEX idx_task_attachments_task_created (task_id, created_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (uploaded_by_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS automations (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, \`trigger\` VARCHAR(30) NOT NULL, actor_type VARCHAR(16) NOT NULL DEFAULT 'ANY', actor_id CHAR(36), service VARCHAR(80), conditions TEXT NOT NULL, actions TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_automations_project (project_id, enabled), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (id CHAR(36) PRIMARY KEY, agent_id CHAR(36) NOT NULL, task_id CHAR(36), event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('task.assigned', 'task.update_added', 'task.status_changed')), payload JSON NOT NULL, status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'RETRYING', 'DELIVERED', 'FAILED')), attempt_count INT NOT NULL DEFAULT 0, next_attempt_at VARCHAR(30) NOT NULL, locked_until VARCHAR(30), last_attempt_at VARCHAR(30), delivered_at VARCHAR(30), failed_at VARCHAR(30), last_error VARCHAR(255), http_status INT, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_webhook_deliveries_due (status, next_attempt_at, locked_until), INDEX idx_webhook_deliveries_agent (agent_id, created_at), FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function migrateSqliteTaskStatusCheck(executor: Executor, force = false, includeLegacyReady = false) {
  const table = await executor.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'", []);
  if (!force && table?.sql.includes("APPROVED") && table.sql.includes("PENDING_DECISION") && table.sql.includes("FAILED") && table.sql.includes("FIX_IN_PROGRESS")) return;
  if (force && !table?.sql.includes("READY_FOR_DEV")) return;
  await executor.run("DROP TABLE IF EXISTS tasks_status_migration", []);
  const statusSql = includeLegacyReady ? legacyTaskStatusSql : taskStatusSql;
  await executor.run(`CREATE TABLE tasks_status_migration (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN (${statusSql})), priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')), type TEXT NOT NULL DEFAULT 'FEATURE' CHECK (type IN ('FEATURE', 'BUG', 'INFRA', 'UPDATE', 'SECURITY', 'DOCS', 'CHORE')), assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES tasks_status_migration(id) ON DELETE CASCADE, branch TEXT, due_date TEXT, estimate_points INTEGER, phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL, pull_request_url TEXT, pull_request_title TEXT, pull_request_state TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`, []);
  await executor.run("INSERT INTO tasks_status_migration (id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id, parent_id, branch, due_date, estimate_points, phase_id, pull_request_url, pull_request_title, pull_request_state, position, created_at, updated_at) SELECT id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id, parent_id, branch, due_date, estimate_points, phase_id, pull_request_url, pull_request_title, pull_request_state, position, created_at, updated_at FROM tasks", []);
  await executor.run("DROP TABLE tasks", []);
  await executor.run("ALTER TABLE tasks_status_migration RENAME TO tasks", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status, position)", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_tasks_project_page ON tasks(project_id, status, position, created_at, id)", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_tasks_updated_page ON tasks(updated_at, id)", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)", []);
  const violation = await executor.get<{ table: string; rowid: number; parent: string }>("PRAGMA foreign_key_check", []);
  if (violation) throw new Error(`Task status migration left a foreign key violation: table=${violation.table}, rowid=${violation.rowid}, parent=${violation.parent}`);
}

async function migrateMysqlTaskStatusCheck(executor: Executor, force = false, includeLegacyReady = false) {
  const checks = await executor.all<{ constraint_name: string; check_clause: string }>(`SELECT tc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS check_clause FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'tasks' AND tc.CONSTRAINT_TYPE = 'CHECK'`, []);
  const statusChecks = checks.filter((check) => /\bstatus\b/i.test(check.check_clause));
  if (!force && statusChecks.some((check) => check.check_clause.includes("APPROVED") && check.check_clause.includes("PENDING_DECISION") && check.check_clause.includes("FAILED") && check.check_clause.includes("FIX_IN_PROGRESS"))) return;
  if (force && !statusChecks.some((check) => check.check_clause.includes("READY_FOR_DEV"))) return;
  for (const check of statusChecks) {
    if (!/^[A-Za-z0-9_$]+$/.test(check.constraint_name)) throw new Error("Unsafe MySQL task status constraint name");
    await executor.run(`ALTER TABLE tasks DROP CHECK \`${check.constraint_name}\``, []);
  }
  const statusSql = includeLegacyReady ? legacyTaskStatusSql : taskStatusSql;
  await executor.run(`ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status CHECK (status IN (${statusSql}))`, []);
}

async function migrateSqliteWebhookEventCheck(executor: Executor) {
  const table = await executor.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'webhook_deliveries'", []);
  if (!table || table.sql.includes("task.status_changed")) return;
  await executor.run("DROP TABLE IF EXISTS webhook_deliveries_migration", []);
  await executor.run("CREATE TABLE webhook_deliveries_migration (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, event_type TEXT NOT NULL CHECK (event_type IN ('task.assigned', 'task.update_added', 'task.status_changed')), payload TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('PENDING', 'RETRYING', 'DELIVERED', 'FAILED')), attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, locked_until TEXT, last_attempt_at TEXT, delivered_at TEXT, failed_at TEXT, last_error TEXT, http_status INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", []);
  await executor.run("INSERT INTO webhook_deliveries_migration SELECT id, agent_id, task_id, event_type, payload, status, attempt_count, next_attempt_at, locked_until, last_attempt_at, delivered_at, failed_at, last_error, http_status, created_at, updated_at FROM webhook_deliveries", []);
  await executor.run("DROP TABLE webhook_deliveries", []);
  await executor.run("ALTER TABLE webhook_deliveries_migration RENAME TO webhook_deliveries", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at, locked_until)", []);
  await executor.run("CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_agent ON webhook_deliveries(agent_id, created_at)", []);
}

async function migrateMysqlWebhookEventCheck(executor: Executor) {
  const checks = await executor.all<{ constraint_name: string; check_clause: string }>(`SELECT tc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS check_clause FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'webhook_deliveries' AND tc.CONSTRAINT_TYPE = 'CHECK'`, []);
  const eventChecks = checks.filter((check) => /event_type/i.test(check.check_clause));
  if (eventChecks.some((check) => check.check_clause.includes("task.status_changed"))) return;
  for (const check of eventChecks) {
    if (!/^[A-Za-z0-9_$]+$/.test(check.constraint_name)) throw new Error("Unsafe MySQL webhook event constraint name");
    await executor.run(`ALTER TABLE webhook_deliveries DROP CHECK \`${check.constraint_name}\``, []);
  }
  await executor.run("ALTER TABLE webhook_deliveries ADD CONSTRAINT chk_webhook_event_type CHECK (event_type IN ('task.assigned', 'task.update_added', 'task.status_changed'))", []);
}

async function tableExists(executor: Executor, dialect: DatabaseDriver, table: string) {
  if (dialect === "sqlite") return Boolean(await executor.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [table]));
  return Number((await executor.get<{ count: number }>("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]))?.count) > 0;
}

async function hasColumn(executor: Executor, dialect: DatabaseDriver, table: string, column: string) {
  if (dialect === "sqlite") return (await executor.all<{ name: string }>(`PRAGMA table_info(${table})`, [])).some((item) => item.name === column);
  return Number((await executor.get<{ count: number }>("SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", [table, column]))?.count) > 0;
}

async function hasIndex(executor: Executor, dialect: DatabaseDriver, table: string, index: string) {
  if (dialect === "sqlite") return (await executor.all<{ name: string }>(`PRAGMA index_list(${table})`, [])).some((item) => item.name === index);
  return Number((await executor.get<{ count: number }>("SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", [table, index]))?.count) > 0;
}

async function addLegacyColumns(executor: Executor, dialect: DatabaseDriver) {
  const columns: Array<[string, string, string, string]> = [
    ["projects", "sort_order", "INTEGER NOT NULL DEFAULT 0", "INT NOT NULL DEFAULT 0"],
    ["projects", "available_statuses", `TEXT NOT NULL DEFAULT '${defaultAvailableStatuses}'`, `VARCHAR(255) NOT NULL DEFAULT '${defaultAvailableStatuses}'`],
    ["projects", "default_status", "TEXT NOT NULL DEFAULT 'TODO'", "VARCHAR(20) NOT NULL DEFAULT 'TODO'"],
    ["tasks", "pull_request_url", "TEXT", "TEXT"],
    ["tasks", "pull_request_title", "TEXT", "VARCHAR(240)"],
    ["tasks", "pull_request_state", "TEXT", "VARCHAR(16)"],
    ["tasks", "phase_id", "TEXT", "CHAR(36)"],
    ["tasks", "type", "TEXT NOT NULL DEFAULT 'FEATURE'", "VARCHAR(16) NOT NULL DEFAULT 'FEATURE'"],
    ["api_tokens", "token_ciphertext", "TEXT", "TEXT"],
    ["api_tokens", "permissions", "TEXT", "TEXT"],
    ["users", "webhook_url", "TEXT", "TEXT"],
    ["users", "webhook_secret_ciphertext", "TEXT", "TEXT"],
    ["users", "webhook_secret_version", "INTEGER NOT NULL DEFAULT 0", "INT NOT NULL DEFAULT 0"],
  ];
  for (const [table, column, sqliteType, mysqlType] of columns) {
    if (!(await hasColumn(executor, dialect, table, column))) {
      await executor.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${dialect === "sqlite" ? sqliteType : mysqlType}`, []);
    }
  }
}

async function preflightTaskStatuses(executor: Executor, dialect: DatabaseDriver, allowLegacyReady = false) {
  if (!(await tableExists(executor, dialect, "tasks"))) return;
  const allowedStatuses = allowLegacyReady ? [...TASK_STATUSES, "READY_FOR_DEV"] : TASK_STATUSES;
  const placeholders = allowedStatuses.map(() => "?").join(", ");
  const invalid = await executor.all<{ id: string; project_id: string; status: string }>(`SELECT id, project_id, status FROM tasks WHERE status NOT IN (${placeholders}) ORDER BY project_id, id`, [...allowedStatuses]);
  if (invalid.length === 0) return;
  const rows = invalid.map((row) => `task_id=${row.id}, project_id=${row.project_id}, status=${row.status}`).join("; ");
  throw new Error(`Migration 0003_expand_task_statuses cannot change the task status constraint because unsupported status rows exist: ${rows}`);
}

async function removeReadyForDev(executor: Executor, dialect: DatabaseDriver) {
  if (await tableExists(executor, dialect, "tasks")) {
    await executor.run("UPDATE tasks SET status = 'TODO' WHERE status = 'READY_FOR_DEV'", []);
  }
  if (await tableExists(executor, dialect, "task_status_history")) {
    await executor.run("UPDATE task_status_history SET status = 'TODO' WHERE status = 'READY_FOR_DEV'", []);
  }
  if (await tableExists(executor, dialect, "projects")) {
    const projects = await executor.all<{ id: string; available_statuses: string; default_status: string }>("SELECT id, available_statuses, default_status FROM projects", []);
    for (const project of projects) {
      let statuses: string[];
      try {
        statuses = JSON.parse(project.available_statuses);
      } catch {
        statuses = [];
      }
      const filtered = statuses.filter((status) => status !== "READY_FOR_DEV");
      const nextStatuses = filtered.length > 0 ? filtered : ["TODO"];
      const defaultStatus = project.default_status === "READY_FOR_DEV" || !nextStatuses.includes(project.default_status) ? nextStatuses[0]! : project.default_status;
      await executor.run("UPDATE projects SET available_statuses = ?, default_status = ? WHERE id = ?", [JSON.stringify(nextStatuses), defaultStatus, project.id]);
    }
  }
  if (await tableExists(executor, dialect, "automations")) {
    const automations = await executor.all<{ id: string; conditions: string; actions: string }>("SELECT id, conditions, actions FROM automations", []);
    for (const automation of automations) {
      const replace = (value: string) => value.replaceAll('"READY_FOR_DEV"', '"TODO"');
      await executor.run("UPDATE automations SET conditions = ?, actions = ? WHERE id = ?", [replace(automation.conditions), replace(automation.actions), automation.id]);
    }
  }
}

const mysqlIndexes: Array<[string, string, string]> = [
  ["api_tokens", "idx_api_tokens_hash", "token_hash"],
  ["projects", "idx_projects_sort_order", "sort_order"],
  ["tasks", "idx_tasks_project_status", "project_id, status, position"],
  ["tasks", "idx_tasks_project_page", "project_id, status, position, created_at, id"],
  ["tasks", "idx_tasks_updated_page", "updated_at, id"],
  ["tasks", "idx_tasks_parent", "parent_id"],
  ["task_tags", "idx_task_tags_tag_task", "tag_id, task_id"],
  ["task_dependencies", "idx_task_dependencies_dependency", "depends_on_task_id, task_id"],
  ["activity", "idx_activity_project_page", "project_id, created_at, id"],
  ["activity", "idx_activity_task_page", "task_id, created_at, id"],
  ["activity", "idx_activity_actor_page", "actor_id, created_at, id"],
  ["notifications", "idx_notifications_user_unread", "user_id, read_at, created_at"],
  ["notifications", "idx_notifications_user_page", "user_id, created_at, id"],
  ["task_updates", "idx_task_updates_task_created", "task_id, created_at"],
  ["task_updates", "idx_task_updates_task_page", "task_id, created_at, id"],
  ["task_attachments", "idx_task_attachments_task_created", "task_id, created_at"],
  ["automations", "idx_automations_project", "project_id, enabled"],
  ["webhook_deliveries", "idx_webhook_deliveries_due", "status, next_attempt_at, locked_until"],
  ["webhook_deliveries", "idx_webhook_deliveries_agent", "agent_id, created_at"],
];

export type Migration = {
  version: string;
  up(executor: Executor, dialect: DatabaseDriver): Promise<void>;
  before?(adapter: Adapter, dialect: DatabaseDriver): Promise<void>;
  after?(adapter: Adapter, dialect: DatabaseDriver): Promise<void>;
};

export const LEGACY_MIGRATION_VERSIONS = [
  "20260821_workflow_status_storage",
  "20260821_workflow_system_default_guard",
  "20260822_task_statuses",
] as const;

export const migrations: readonly Migration[] = [
  {
    version: "0001_core_schema",
    async up(executor, dialect) {
      const schema = dialect === "mysql" ? mysqlSchema : sqliteSchema;
      await runStatements(executor, schema.filter((statement) => /^CREATE TABLE/i.test(statement)));
    },
  },
  {
    version: "0002_legacy_columns",
    up: addLegacyColumns,
  },
  {
    version: "0003_expand_task_statuses",
    before: async (adapter, dialect) => {
      await preflightTaskStatuses(adapter, dialect, true);
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = OFF", []);
    },
    async up(executor, dialect) {
      if (dialect === "sqlite") await migrateSqliteTaskStatusCheck(executor, false, true);
      else await migrateMysqlTaskStatusCheck(executor, false, true);
    },
    after: async (adapter, dialect) => {
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = ON", []);
    },
  },
  {
    version: "0004_project_status_defaults",
    async up(executor) {
      await executor.run("UPDATE projects SET available_statuses = ? WHERE available_statuses = ?", [legacyDefaultAvailableStatuses, legacyAvailableStatuses]);
    },
  },
  {
    version: "0005_query_indexes",
    async up(executor, dialect) {
      if (dialect === "sqlite") {
        await runStatements(executor, sqliteSchema.filter((statement) => /^CREATE (?:UNIQUE )?INDEX/i.test(statement)));
        return;
      }
      for (const [table, index, columns] of mysqlIndexes) {
        if (!(await hasIndex(executor, dialect, table, index))) await executor.run(`CREATE INDEX ${index} ON ${table} (${columns})`, []);
      }
    },
  },
  {
    version: "0006_security_audit_events",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS security_audit_events (id CHAR(36) PRIMARY KEY, action VARCHAR(80) NOT NULL, outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'failure', 'throttled')), ip_address VARCHAR(160) NOT NULL, account VARCHAR(320), user_id CHAR(36), created_at VARCHAR(30) NOT NULL, INDEX idx_security_audit_created (created_at, id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS security_audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'throttled')), ip_address TEXT NOT NULL, account TEXT, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL)", []);
      if (dialect === "sqlite") await executor.run("CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_events(created_at, id)", []);
    },
  },
  {
    version: "0007_task_status_history",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS task_status_history (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, status VARCHAR(32) NOT NULL, entered_at VARCHAR(30) NOT NULL, exited_at VARCHAR(30), duration_seconds INT, INDEX idx_task_status_history_task (task_id, entered_at, id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS task_status_history (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, status TEXT NOT NULL, entered_at TEXT NOT NULL, exited_at TEXT, duration_seconds INTEGER)", []);
      if (dialect === "sqlite") await executor.run("CREATE INDEX IF NOT EXISTS idx_task_status_history_task ON task_status_history(task_id, entered_at, id)", []);
    },
  },
  {
    version: "0008_autonomous_workflow_statuses",
    before: async (adapter, dialect) => {
      await preflightTaskStatuses(adapter, dialect, true);
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = OFF", []);
    },
    async up(executor, dialect) {
      if (dialect === "sqlite") await migrateSqliteTaskStatusCheck(executor, false, true);
      else await migrateMysqlTaskStatusCheck(executor, false, true);
    },
    after: async (adapter, dialect) => {
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = ON", []);
    },
  },
  {
    version: "0009_status_changed_webhook_event",
    async up(executor, dialect) {
      if (dialect === "sqlite") await migrateSqliteWebhookEventCheck(executor);
      else await migrateMysqlWebhookEventCheck(executor);
    },
  },
  {
    version: "0010_agent_runs",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS agent_runs (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, project_id CHAR(36) NOT NULL, requested_by_id CHAR(36) NOT NULL, kind VARCHAR(20) NOT NULL CHECK (kind IN ('IMPLEMENTATION', 'REVIEW', 'RE_REVIEW', 'FIX')), status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')), attempt_count INT NOT NULL DEFAULT 0, max_attempts INT NOT NULL DEFAULT 3, lease_owner VARCHAR(255), lease_expires_at VARCHAR(30), heartbeat_at VARCHAR(30), timeout_at VARCHAR(30), last_error TEXT, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, completed_at VARCHAR(30), INDEX idx_agent_runs_task (task_id, created_at), INDEX idx_agent_runs_lease (status, lease_expires_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (requested_by_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, requested_by_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK (kind IN ('IMPLEMENTATION', 'REVIEW', 'RE_REVIEW', 'FIX')), status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')), attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, lease_owner TEXT, lease_expires_at TEXT, heartbeat_at TEXT, timeout_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)", []);
      if (dialect === "sqlite") {
        await executor.run("CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id, created_at)", []);
        await executor.run("CREATE INDEX IF NOT EXISTS idx_agent_runs_lease ON agent_runs(status, lease_expires_at)", []);
      }
    },
  },
  {
    version: "0011_task_gate_evidence",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS task_gate_evidence (task_id CHAR(36) PRIMARY KEY, head_sha CHAR(64) NOT NULL, required_checks JSON NOT NULL, checks_json JSON NOT NULL, approved_head_sha CHAR(64), approved_by_id CHAR(36), approved_at VARCHAR(30), merged_head_sha CHAR(64), merged_by_id CHAR(36), merged_at VARCHAR(30), updated_at VARCHAR(30) NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (approved_by_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (merged_by_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS task_gate_evidence (task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, head_sha TEXT NOT NULL, required_checks TEXT NOT NULL, checks_json TEXT NOT NULL, approved_head_sha TEXT, approved_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, approved_at TEXT, merged_head_sha TEXT, merged_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, merged_at TEXT, updated_at TEXT NOT NULL)", []);
    },
  },
  {
    version: "0012_task_findings",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS task_findings (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, run_id CHAR(36), author_id CHAR(36) NOT NULL, severity VARCHAR(2) NOT NULL CHECK (severity IN ('P0','P1','P2','P3')), title VARCHAR(255) NOT NULL, body TEXT NOT NULL, file_path VARCHAR(1024), line_number INT, disposition VARCHAR(16) NOT NULL CHECK (disposition IN ('OPEN','ACCEPTED','FIX_NEEDED','DEFERRED','REJECTED','ESCALATED')), disposition_by_id CHAR(36), disposition_reason TEXT, decision_owner_id CHAR(36), due_at VARCHAR(30), created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_task_findings_task (task_id, created_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL, FOREIGN KEY (author_id) REFERENCES users(id), FOREIGN KEY (disposition_by_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (decision_owner_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS task_findings (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL, author_id TEXT NOT NULL REFERENCES users(id), severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')), title TEXT NOT NULL, body TEXT NOT NULL, file_path TEXT, line_number INTEGER, disposition TEXT NOT NULL CHECK (disposition IN ('OPEN','ACCEPTED','FIX_NEEDED','DEFERRED','REJECTED','ESCALATED')), disposition_by_id TEXT REFERENCES users(id) ON DELETE SET NULL, disposition_reason TEXT, decision_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL, due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)", []);
      if (dialect === "sqlite") await executor.run("CREATE INDEX IF NOT EXISTS idx_task_findings_task ON task_findings(task_id, created_at)", []);
    },
  },
  {
    version: "0013_project_local_repo_path",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql" ? "ALTER TABLE projects ADD COLUMN local_repo_path VARCHAR(2048) NULL" : "ALTER TABLE projects ADD COLUMN local_repo_path TEXT", []);
    },
  },
  {
    version: "0014_agent_logs",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "CREATE TABLE IF NOT EXISTS agent_logs (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, run_id CHAR(36), provider VARCHAR(64) NOT NULL, stream VARCHAR(16) NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system', 'callback')), category VARCHAR(16) NOT NULL CHECK (category IN ('output', 'progress', 'tool', 'callback', 'lifecycle')), `sequence` INT NOT NULL, event_id VARCHAR(180) UNIQUE, content TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, INDEX idx_agent_logs_task_page (task_id, created_at, id), INDEX idx_agent_logs_run_sequence (run_id, `sequence`), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        : "CREATE TABLE IF NOT EXISTS agent_logs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL, provider TEXT NOT NULL, stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system', 'callback')), category TEXT NOT NULL CHECK (category IN ('output', 'progress', 'tool', 'callback', 'lifecycle')), `sequence` INTEGER NOT NULL, event_id TEXT UNIQUE, content TEXT NOT NULL, created_at TEXT NOT NULL)", []);
      if (dialect === "sqlite") {
        await executor.run("CREATE INDEX IF NOT EXISTS idx_agent_logs_task_page ON agent_logs(task_id, created_at, id)", []);
        await executor.run("CREATE INDEX IF NOT EXISTS idx_agent_logs_run_sequence ON agent_logs(run_id, `sequence`)", []);
      }
    },
  },
  {
    version: "0015_fix_in_progress_status",
    before: async (adapter, dialect) => {
      await preflightTaskStatuses(adapter, dialect, true);
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = OFF", []);
    },
    async up(executor, dialect) {
      if (dialect === "sqlite") await migrateSqliteTaskStatusCheck(executor, false, true);
      else await migrateMysqlTaskStatusCheck(executor, false, true);
    },
    after: async (adapter, dialect) => {
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = ON", []);
    },
  },
  {
    version: "0016_remove_ready_for_dev_status",
    before: async (adapter, dialect) => {
      await removeReadyForDev(adapter, dialect);
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = OFF", []);
    },
    async up(executor, dialect) {
      if (dialect === "sqlite") await migrateSqliteTaskStatusCheck(executor, true);
      else await migrateMysqlTaskStatusCheck(executor, true);
    },
    after: async (adapter, dialect) => {
      if (dialect === "sqlite") await adapter.run("PRAGMA foreign_keys = ON", []);
    },
  },
  {
    version: "0017_project_agent_workflow",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "ALTER TABLE projects ADD COLUMN agent_workflow JSON NULL"
        : "ALTER TABLE projects ADD COLUMN agent_workflow TEXT NULL", []);
    },
  },
  {
    version: "0018_project_hidden_empty_statuses",
    async up(executor, dialect) {
      await executor.run(dialect === "mysql"
        ? "ALTER TABLE projects ADD COLUMN hidden_empty_statuses TEXT NULL"
        : "ALTER TABLE projects ADD COLUMN hidden_empty_statuses TEXT NULL", []);
      const projects = await executor.all<{ id: string; available_statuses: string }>("SELECT id, available_statuses FROM projects", []);
      for (const project of projects) {
        let statuses: string[] = [];
        try { const parsed = JSON.parse(project.available_statuses); if (Array.isArray(parsed)) statuses = parsed.filter((status): status is string => typeof status === "string"); } catch { /* Use the shipped default below. */ }
        if (!statuses.length) statuses = [...DEFAULT_PROJECT_STATUSES];
        await executor.run("UPDATE projects SET hidden_empty_statuses = ? WHERE id = ?", [JSON.stringify(statuses), project.id]);
      }
    },
  },
];

async function validateMigrationLedger(adapter: Adapter, registry: readonly Migration[]) {
  const rows = await adapter.all<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version", []);
  const known = new Set([...registry.map((migration) => migration.version), ...LEGACY_MIGRATION_VERSIONS]);
  const unknown = rows.map((row) => row.version).filter((version) => !known.has(version));
  if (unknown.length > 0) throw new Error(`Database has unknown migration version(s): ${unknown.join(", ")}. Start TaskForge with a matching or newer release; do not edit the migration ledger manually.`);

  const applied = new Set(rows.map((row) => row.version));
  let missing: string | undefined;
  for (const migration of registry) {
    if (!applied.has(migration.version)) missing ??= migration.version;
    else if (missing) throw new Error(`Database migration history is inconsistent: ${migration.version} is applied after missing ${missing}. Restore the ledger from backup or deploy the release that created it.`);
  }
  return applied;
}

export async function runMigrations(adapter: Adapter, dialect: DatabaseDriver, registry: readonly Migration[] = migrations) {
  await adapter.withMigrationLock(async () => {
    await adapter.run("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY, applied_at VARCHAR(30) NOT NULL)", []);
    const applied = await validateMigrationLedger(adapter, registry);
    for (const migration of registry) {
      if (applied.has(migration.version)) continue;
      try {
        await migration.before?.(adapter, dialect);
        const apply = async (executor: Executor) => {
          if (await executor.get("SELECT 1 FROM schema_migrations WHERE version = ?", [migration.version])) return;
          await migration.up(executor, dialect);
          await executor.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [migration.version, new Date().toISOString()]);
        };
        if (dialect === "sqlite") await adapter.transaction(apply, { immediate: true });
        else await apply(adapter);
        applied.add(migration.version);
      } finally {
        await migration.after?.(adapter, dialect);
      }
    }
  });
}

export const db = new Database();
