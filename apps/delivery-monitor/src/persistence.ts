import Sqlite from "better-sqlite3";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

export type MonitorCheckpoint = {
  runId: string; taskId: string; pullRequestUrl: string; cursor: string | null;
  etag: string | null; lastState: string | null; observedAt: string | null;
  retryCount: number; nextAttemptAt: string | null; lastError: string | null;
};

export type MonitorLease = { runId: string; ownerId: string; acquiredAt: string; expiresAt: string };

export interface MonitorStore {
  migrate(): Promise<void>;
  load(runId: string, taskId: string, pullRequestUrl: string): Promise<MonitorCheckpoint | null>;
  save(checkpoint: MonitorCheckpoint): Promise<void>;
  acquireLease(runId: string, ownerId: string, now: string, expiresAt: string): Promise<MonitorLease | null>;
  releaseLease(runId: string, ownerId: string): Promise<void>;
  close(): Promise<void>;
}

const sqliteSchema = `CREATE TABLE IF NOT EXISTS delivery_monitor_checkpoints (run_id TEXT NOT NULL, task_id TEXT NOT NULL, pull_request_url TEXT NOT NULL, cursor TEXT, etag TEXT, last_state TEXT, observed_at TEXT, retry_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, task_id, pull_request_url));
CREATE TABLE IF NOT EXISTS delivery_monitor_leases (run_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL);`;
const mysqlSchema = `CREATE TABLE IF NOT EXISTS delivery_monitor_checkpoints (run_id CHAR(36) NOT NULL, task_id CHAR(36) NOT NULL, pull_request_url VARCHAR(2048) NOT NULL, cursor TEXT, etag VARCHAR(512), last_state VARCHAR(16), observed_at VARCHAR(30), retry_count INT NOT NULL DEFAULT 0, next_attempt_at VARCHAR(30), last_error TEXT, updated_at VARCHAR(30) NOT NULL, PRIMARY KEY (run_id, task_id, pull_request_url(255))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS delivery_monitor_leases (run_id CHAR(36) PRIMARY KEY, owner_id VARCHAR(255) NOT NULL, acquired_at VARCHAR(30) NOT NULL, expires_at VARCHAR(30) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

export class SqliteMonitorStore implements MonitorStore {
  private db: Sqlite.Database;
  constructor(path: string) { this.db = new Sqlite(path); this.db.pragma("journal_mode = WAL"); this.db.pragma("busy_timeout = 5000"); }
  async migrate() { for (const statement of sqliteSchema.split(";")) if (statement.trim()) this.db.exec(statement); }
  async load(runId: string, taskId: string, pullRequestUrl: string) { return (this.db.prepare("SELECT run_id as runId, task_id as taskId, pull_request_url as pullRequestUrl, cursor, etag, last_state as lastState, observed_at as observedAt, retry_count as retryCount, next_attempt_at as nextAttemptAt, last_error as lastError FROM delivery_monitor_checkpoints WHERE run_id = ? AND task_id = ? AND pull_request_url = ?").get(runId, taskId, pullRequestUrl) as MonitorCheckpoint | undefined) ?? null; }
  async save(c: MonitorCheckpoint) { this.db.prepare("INSERT INTO delivery_monitor_checkpoints (run_id,task_id,pull_request_url,cursor,etag,last_state,observed_at,retry_count,next_attempt_at,last_error,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,task_id,pull_request_url) DO UPDATE SET cursor=excluded.cursor,etag=excluded.etag,last_state=excluded.last_state,observed_at=excluded.observed_at,retry_count=excluded.retry_count,next_attempt_at=excluded.next_attempt_at,last_error=excluded.last_error,updated_at=excluded.updated_at").run(c.runId,c.taskId,c.pullRequestUrl,c.cursor,c.etag,c.lastState,c.observedAt,c.retryCount,c.nextAttemptAt,c.lastError,new Date().toISOString()); }
  async acquireLease(runId: string, ownerId: string, now: string, expiresAt: string) { const result = this.db.prepare("INSERT INTO delivery_monitor_leases (run_id,owner_id,acquired_at,expires_at) VALUES (?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET owner_id=excluded.owner_id,acquired_at=excluded.acquired_at,expires_at=excluded.expires_at WHERE delivery_monitor_leases.expires_at <= excluded.acquired_at").run(runId,ownerId,now,expiresAt); return result.changes ? { runId, ownerId, acquiredAt: now, expiresAt } : null; }
  async releaseLease(runId: string, ownerId: string) { this.db.prepare("DELETE FROM delivery_monitor_leases WHERE run_id = ? AND owner_id = ?").run(runId, ownerId); }
  async close() { this.db.close(); }
}

export class MysqlMonitorStore implements MonitorStore {
  private pool: mysql.Pool;
  constructor(private url: string) { this.pool = mysql.createPool({ uri: url, connectionLimit: 5 }); }
  async migrate() { for (const statement of mysqlSchema.split(";")) if (statement.trim()) await this.pool.execute(statement); }
  async load(runId: string, taskId: string, pullRequestUrl: string) { const [rows] = await this.pool.execute("SELECT run_id runId, task_id taskId, pull_request_url pullRequestUrl, cursor, etag, last_state lastState, observed_at observedAt, retry_count retryCount, next_attempt_at nextAttemptAt, last_error lastError FROM delivery_monitor_checkpoints WHERE run_id=? AND task_id=? AND pull_request_url=?", [runId,taskId,pullRequestUrl]); return ((rows as MonitorCheckpoint[])[0] ?? null); }
  async save(c: MonitorCheckpoint) { await this.pool.execute("INSERT INTO delivery_monitor_checkpoints (run_id,task_id,pull_request_url,cursor,etag,last_state,observed_at,retry_count,next_attempt_at,last_error,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE cursor=VALUES(cursor),etag=VALUES(etag),last_state=VALUES(last_state),observed_at=VALUES(observed_at),retry_count=VALUES(retry_count),next_attempt_at=VALUES(next_attempt_at),last_error=VALUES(last_error),updated_at=VALUES(updated_at)",[c.runId,c.taskId,c.pullRequestUrl,c.cursor,c.etag,c.lastState,c.observedAt,c.retryCount,c.nextAttemptAt,c.lastError,new Date().toISOString()]); }
  async acquireLease(runId: string, ownerId: string, now: string, expiresAt: string) { const [result] = await this.pool.execute("INSERT INTO delivery_monitor_leases (run_id,owner_id,acquired_at,expires_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE owner_id=IF(expires_at <= VALUES(acquired_at), VALUES(owner_id), owner_id), acquired_at=IF(expires_at <= VALUES(acquired_at), VALUES(acquired_at), acquired_at), expires_at=IF(expires_at <= VALUES(acquired_at), VALUES(expires_at), expires_at)",[runId,ownerId,now,expiresAt]); return (result as { affectedRows?: number }).affectedRows ? { runId,ownerId,acquiredAt:now,expiresAt } : null; }
  async releaseLease(runId: string, ownerId: string) { await this.pool.execute("DELETE FROM delivery_monitor_leases WHERE run_id=? AND owner_id=?",[runId,ownerId]); }
  async close() { await this.pool.end(); }
}

export function newMonitorRunId() { return randomUUID(); }
