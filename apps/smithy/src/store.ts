import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface Job { eventId: string; provider: string; taskId: string; body: string; runId: string | null; status: JobStatus; createdAt: string; updatedAt: string; }
export interface JobStore { accept(eventId: string, provider: string, taskId: string, body: string): { job: Job; duplicate: boolean }; setRunId(eventId: string, runId: string): void; markRunning(eventId: string): void; markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED"): void; requeue(eventId: string): boolean; cancel(eventId: string): boolean; pending(): Job[]; close?(): void; }

export class SqliteJobStore implements JobStore {
  private readonly db: Database.Database;
  constructor(path = process.env.SMITHY_DB_PATH ?? "./data/smithy.sqlite") {
    mkdirSync(pathModuleDir(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    const existed = Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smithy_jobs'").get());
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_schema (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_jobs (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, body TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    try { this.db.exec("ALTER TABLE smithy_jobs ADD COLUMN run_id TEXT"); } catch { /* already present */ }
    if (existed && !this.db.prepare("SELECT 1 FROM smithy_schema WHERE key = 'cancelled-jobs'").get()) {
      this.db.transaction(() => {
        this.db.exec("CREATE TABLE smithy_jobs_migration (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, body TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        this.db.exec("INSERT INTO smithy_jobs_migration SELECT event_id, provider, task_id, body, run_id, status, created_at, updated_at FROM smithy_jobs");
        this.db.exec("DROP TABLE smithy_jobs");
        this.db.exec("ALTER TABLE smithy_jobs_migration RENAME TO smithy_jobs");
        this.db.prepare("INSERT INTO smithy_schema (key, value) VALUES ('cancelled-jobs', '1')").run();
      })();
    } else {
      this.db.prepare("INSERT OR IGNORE INTO smithy_schema (key, value) VALUES ('cancelled-jobs', '1')").run();
    }
  }
  accept(eventId: string, provider: string, taskId: string, body: string) {
    const existing = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ?").get(eventId) as Record<string, unknown> | undefined;
    if (existing) return { job: this.map(existing), duplicate: true };
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO smithy_jobs (event_id, provider, task_id, body, run_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'PENDING', ?, ?)").run(eventId, provider, taskId, body, now, now);
    const job: Job = { eventId, provider, taskId, body, runId: null, status: "PENDING", createdAt: now, updatedAt: now };
    return { job, duplicate: false };
  }
  markRunning(eventId: string) { this.db.prepare("UPDATE smithy_jobs SET status = 'RUNNING', updated_at = ? WHERE event_id = ? AND status IN ('PENDING', 'RUNNING')").run(new Date().toISOString(), eventId); }
  setRunId(eventId: string, runId: string) { this.db.prepare("UPDATE smithy_jobs SET run_id = ?, updated_at = ? WHERE event_id = ?").run(runId, new Date().toISOString(), eventId); }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED") { this.db.prepare("UPDATE smithy_jobs SET status = ?, updated_at = ? WHERE event_id = ?").run(status, new Date().toISOString(), eventId); }
  requeue(eventId: string) { return Boolean(this.db.prepare("UPDATE smithy_jobs SET status = 'PENDING', updated_at = ? WHERE event_id = ? AND status = 'FAILED'").run(new Date().toISOString(), eventId).changes); }
  cancel(eventId: string) { return Boolean(this.db.prepare("UPDATE smithy_jobs SET status = 'CANCELLED', updated_at = ? WHERE event_id = ? AND status IN ('PENDING', 'RUNNING', 'FAILED')").run(new Date().toISOString(), eventId).changes); }
  pending() { return (this.db.prepare("SELECT * FROM smithy_jobs WHERE status IN ('PENDING', 'RUNNING') ORDER BY created_at").all() as Record<string, unknown>[]).map((row) => this.map(row)); }
  close() { this.db.close(); }
  private map(row: Record<string, unknown>): Job { return { eventId: String(row.event_id), provider: String(row.provider), taskId: String(row.task_id), body: String(row.body), runId: row.run_id ? String(row.run_id) : null, status: row.status as JobStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
}

const pathModuleDir = (file: string) => path.dirname(path.resolve(file));

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  accept(eventId: string, provider: string, taskId: string, body: string) { const existing = this.jobs.get(eventId); if (existing) return { job: existing, duplicate: true }; const now = new Date().toISOString(); const job: Job = { eventId, provider, taskId, body, runId: null, status: "PENDING", createdAt: now, updatedAt: now }; this.jobs.set(eventId, job); return { job, duplicate: false }; }
  setRunId(eventId: string, runId: string) { const job = this.jobs.get(eventId); if (job) job.runId = runId; }
  markRunning(eventId: string) { const job = this.jobs.get(eventId); if (job) job.status = "RUNNING"; }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED") { const job = this.jobs.get(eventId); if (job) job.status = status; }
  requeue(eventId: string) { const job = this.jobs.get(eventId); if (!job || job.status !== "FAILED") return false; job.status = "PENDING"; return true; }
  cancel(eventId: string) { const job = this.jobs.get(eventId); if (!job || !["PENDING", "RUNNING", "FAILED"].includes(job.status)) return false; job.status = "CANCELLED"; return true; }
  pending() { return [...this.jobs.values()].filter((job) => job.status === "PENDING" || job.status === "RUNNING"); }
}
