import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import Sqlite from "better-sqlite3";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { config } from "../config.js";

export type DatabaseDriver = "sqlite" | "mysql";
export type Row = Record<string, unknown>;
export type RunResult = { changes: number };

interface Executor {
  get<T extends Row>(sql: string, params: unknown[]): Promise<T | undefined>;
  all<T extends Row>(sql: string, params: unknown[]): Promise<T[]>;
  run(sql: string, params: unknown[]): Promise<RunResult>;
}

interface Adapter extends Executor {
  transaction<T>(callback: (executor: Executor) => Promise<T>): Promise<T>;
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

function createMysqlAdapter(url: string): Adapter {
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
    async close() { await pool.end(); },
  };
}

function createSqliteAdapter(databasePath: string): Adapter {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Sqlite(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
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
    async transaction<T>(callback: (transactionExecutor: Executor) => Promise<T>) {
      const previous = transactionQueue;
      let release = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      transactionQueue = previous.then(() => gate);
      queuedTransactions += 1;
      await previous;
      try {
        sqlite.exec("BEGIN");
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
    this.ready = migrate(this.adapter, this.dialect);
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

const sqliteSchema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, password_hash TEXT, kind TEXT NOT NULL CHECK (kind IN ('HUMAN', 'AGENT')), role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')), avatar_url TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', repo_url TEXT, color TEXT NOT NULL DEFAULT '#6554C0', owner_id TEXT NOT NULL REFERENCES users(id), next_task_number INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')), created_at TEXT NOT NULL, PRIMARY KEY (project_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS phases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, goal TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_phases_one_active ON phases(project_id) WHERE is_active = 1`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', definition_of_done TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')), priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')), assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL, creator_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, branch TEXT, due_date TEXT, estimate_points INTEGER, phase_id TEXT REFERENCES phases(id) ON DELETE SET NULL, pull_request_url TEXT, pull_request_title TEXT, pull_request_state TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, number))`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)`,
  `CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE, created_at TEXT NOT NULL, UNIQUE (project_id, name))`,
  `CREATE TABLE IF NOT EXISTS task_tags (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (task_id, tag_id))`,
  `CREATE INDEX IF NOT EXISTS idx_task_tags_tag_task ON task_tags(tag_id, task_id)`,
  `CREATE TABLE IF NOT EXISTS task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, created_at TEXT NOT NULL, PRIMARY KEY (task_id, depends_on_task_id), CHECK (task_id <> depends_on_task_id))`,
  `CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependency ON task_dependencies(depends_on_task_id, task_id)`,
  `CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', read_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS task_updates (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_task_updates_task_created ON task_updates(task_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS task_attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, storage_key TEXT NOT NULL UNIQUE, uploaded_by_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_task_attachments_task_created ON task_attachments(task_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, trigger TEXT NOT NULL, actor_type TEXT NOT NULL DEFAULT 'ANY', actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, service TEXT, conditions TEXT NOT NULL, actions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id, enabled)`,
];

const mysqlSchema = [
  `CREATE TABLE IF NOT EXISTS users (id CHAR(36) PRIMARY KEY, email VARCHAR(320) UNIQUE, name VARCHAR(120) NOT NULL, password_hash VARCHAR(255), kind VARCHAR(16) NOT NULL CHECK (kind IN ('HUMAN', 'AGENT')), role VARCHAR(16) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MEMBER')), avatar_url TEXT, created_at VARCHAR(30) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS api_tokens (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, token_prefix VARCHAR(32) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at VARCHAR(30), last_used_at VARCHAR(30), revoked_at VARCHAR(30), created_at VARCHAR(30) NOT NULL, INDEX idx_api_tokens_hash (token_hash), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS projects (id CHAR(36) PRIMARY KEY, \`key\` VARCHAR(8) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL, description TEXT NOT NULL, repo_url TEXT, color CHAR(7) NOT NULL DEFAULT '#6554C0', owner_id CHAR(36) NOT NULL, next_task_number INT NOT NULL DEFAULT 1, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, FOREIGN KEY (owner_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS project_members (project_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER', 'MEMBER')), created_at VARCHAR(30) NOT NULL, PRIMARY KEY (project_id, user_id), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS phases (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, goal TEXT NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_phase_number (project_id, number), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tasks (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, number INT NOT NULL, title VARCHAR(240) NOT NULL, description TEXT NOT NULL, definition_of_done TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'TODO' CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE')), priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')), assignee_id CHAR(36), creator_id CHAR(36) NOT NULL, parent_id CHAR(36), branch VARCHAR(255), due_date VARCHAR(10), estimate_points INT, phase_id CHAR(36), pull_request_url TEXT, pull_request_title VARCHAR(240), pull_request_state VARCHAR(16), position INT NOT NULL DEFAULT 0, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_task_number (project_id, number), INDEX idx_tasks_project_status (project_id, status, position), INDEX idx_tasks_parent (parent_id), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (creator_id) REFERENCES users(id), FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tags (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(32) NOT NULL, created_at VARCHAR(30) NOT NULL, UNIQUE KEY uq_tag_name (project_id, name), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_tags (task_id CHAR(36) NOT NULL, tag_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, PRIMARY KEY (task_id, tag_id), INDEX idx_task_tags_tag_task (tag_id, task_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_dependencies (task_id CHAR(36) NOT NULL, depends_on_task_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, PRIMARY KEY (task_id, depends_on_task_id), INDEX idx_task_dependencies_dependency (depends_on_task_id, task_id), CHECK (task_id <> depends_on_task_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS activity (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, task_id CHAR(36), actor_id CHAR(36) NOT NULL, action VARCHAR(80) NOT NULL, metadata TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (actor_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS notifications (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, project_id CHAR(36), task_id CHAR(36), type VARCHAR(60) NOT NULL, title VARCHAR(240) NOT NULL, message TEXT NOT NULL, read_at VARCHAR(30), created_at VARCHAR(30) NOT NULL, INDEX idx_notifications_user_unread (user_id, read_at, created_at), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_updates (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, author_id CHAR(36) NOT NULL, body TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_task_updates_task_created (task_id, created_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS task_attachments (id CHAR(36) PRIMARY KEY, task_id CHAR(36) NOT NULL, file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(160) NOT NULL, file_size BIGINT NOT NULL, storage_key VARCHAR(255) NOT NULL UNIQUE, uploaded_by_id CHAR(36) NOT NULL, created_at VARCHAR(30) NOT NULL, INDEX idx_task_attachments_task_created (task_id, created_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (uploaded_by_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS automations (id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 1, trigger VARCHAR(30) NOT NULL, actor_type VARCHAR(16) NOT NULL DEFAULT 'ANY', actor_id CHAR(36), service VARCHAR(80), conditions TEXT NOT NULL, actions TEXT NOT NULL, created_at VARCHAR(30) NOT NULL, updated_at VARCHAR(30) NOT NULL, INDEX idx_automations_project (project_id, enabled), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function migrate(adapter: Adapter, dialect: DatabaseDriver) {
  await runStatements(adapter, dialect === "mysql" ? mysqlSchema : sqliteSchema);
  if (dialect === "sqlite") {
    const columns = new Set((await adapter.all<{ name: string }>("PRAGMA table_info(tasks)", [])).map((column) => column.name));
    if (!columns.has("pull_request_url")) await adapter.run("ALTER TABLE tasks ADD COLUMN pull_request_url TEXT", []);
    if (!columns.has("pull_request_title")) await adapter.run("ALTER TABLE tasks ADD COLUMN pull_request_title TEXT", []);
    if (!columns.has("pull_request_state")) await adapter.run("ALTER TABLE tasks ADD COLUMN pull_request_state TEXT", []);
    if (!columns.has("phase_id")) await adapter.run("ALTER TABLE tasks ADD COLUMN phase_id TEXT", []);
  }
}

export const db = new Database();
