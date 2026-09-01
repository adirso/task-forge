import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface Job { eventId: string; provider: string; taskId: string; body: string; runId: string | null; status: JobStatus; attemptCount: number; maxAttempts: number; createdAt: string; updatedAt: string; }
export type ForceResult = { status: "accepted" | "duplicate"; job: Job } | { status: "not_found" } | { status: "not_failed" };
export interface JobStore { accept(eventId: string, provider: string, taskId: string, body: string): { job: Job; duplicate: boolean }; force(requestId: string, provider: string, taskId: string, eventId: string): ForceResult; setRunId(eventId: string, runId: string): void; markRunning(eventId: string): void; markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED"): void; requeue(eventId: string, staleBefore?: string): boolean; cancel(eventId: string): boolean; pending(): Job[]; close?(): void; }

export class SqliteJobStore implements JobStore {
  private readonly db: Database.Database;
  constructor(path = process.env.SMITHY_DB_PATH ?? "./data/smithy.sqlite") {
    mkdirSync(pathModuleDir(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    const existed = Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smithy_jobs'").get());
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_schema (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_jobs (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, body TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')), attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_force_requests (request_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES smithy_jobs(event_id) ON DELETE CASCADE, created_at TEXT NOT NULL)");
    try { this.db.exec("ALTER TABLE smithy_jobs ADD COLUMN run_id TEXT"); } catch { /* already present */ }
    if (existed && !this.db.prepare("SELECT 1 FROM smithy_schema WHERE key = 'cancelled-jobs'").get()) {
      this.db.transaction(() => {
        this.db.exec("CREATE TABLE smithy_jobs_migration (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, body TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')), attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        this.db.exec("INSERT INTO smithy_jobs_migration (event_id, provider, task_id, body, run_id, status, attempt_count, max_attempts, created_at, updated_at) SELECT event_id, provider, task_id, body, run_id, status, 0, 3, created_at, updated_at FROM smithy_jobs");
        this.db.exec("DROP TABLE smithy_jobs");
        this.db.exec("ALTER TABLE smithy_jobs_migration RENAME TO smithy_jobs");
        this.db.prepare("INSERT INTO smithy_schema (key, value) VALUES ('cancelled-jobs', '1')").run();
      })();
    } else {
      this.db.prepare("INSERT OR IGNORE INTO smithy_schema (key, value) VALUES ('cancelled-jobs', '1')").run();
      const columns = this.db.prepare("PRAGMA table_info(smithy_jobs)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "attempt_count")) this.db.exec("ALTER TABLE smithy_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0");
      if (!columns.some((column) => column.name === "max_attempts")) this.db.exec("ALTER TABLE smithy_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3");
    }
  }
  accept(eventId: string, provider: string, taskId: string, body: string) {
    const existing = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ?").get(eventId) as Record<string, unknown> | undefined;
    if (existing) return { job: this.map(existing), duplicate: true };
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO smithy_jobs (event_id, provider, task_id, body, run_id, status, attempt_count, max_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'PENDING', 0, 3, ?, ?)").run(eventId, provider, taskId, body, now, now);
    const job: Job = { eventId, provider, taskId, body, runId: null, status: "PENDING", attemptCount: 0, maxAttempts: 3, createdAt: now, updatedAt: now };
    return { job, duplicate: false };
  }
  force(requestId: string, provider: string, taskId: string, eventId: string): ForceResult {
    return this.db.transaction(() => {
      const duplicate = this.db.prepare("SELECT provider, task_id, event_id FROM smithy_force_requests WHERE request_id = ?").get(requestId) as { provider: string; task_id: string; event_id: string } | undefined;
      if (duplicate) {
        if (duplicate.provider !== provider || duplicate.task_id !== taskId || duplicate.event_id !== eventId) return { status: "not_found" as const };
        const row = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ?").get(duplicate.event_id) as Record<string, unknown> | undefined;
        return row ? { status: "duplicate" as const, job: this.map(row) } : { status: "not_found" as const };
      }
      const row = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ? AND task_id = ? AND provider = ?").get(eventId, taskId, provider) as Record<string, unknown> | undefined;
      if (!row) return { status: "not_found" as const };
      if (row.status !== "FAILED") return { status: "not_failed" as const };
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO smithy_force_requests (request_id, provider, task_id, event_id, created_at) VALUES (?, ?, ?, ?, ?)").run(requestId, provider, taskId, eventId, now);
      this.db.prepare("UPDATE smithy_jobs SET status = 'PENDING', max_attempts = MAX(max_attempts, attempt_count + 1), updated_at = ? WHERE event_id = ? AND status = 'FAILED'").run(now, eventId);
      const updated = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ?").get(eventId) as Record<string, unknown>;
      return { status: "accepted" as const, job: this.map(updated) };
    })();
  }
  markRunning(eventId: string) { this.db.prepare("UPDATE smithy_jobs SET status = 'RUNNING', attempt_count = attempt_count + 1, updated_at = ? WHERE event_id = ? AND status IN ('PENDING', 'RUNNING') AND attempt_count < max_attempts").run(new Date().toISOString(), eventId); }
  setRunId(eventId: string, runId: string) { this.db.prepare("UPDATE smithy_jobs SET run_id = ?, updated_at = ? WHERE event_id = ?").run(runId, new Date().toISOString(), eventId); }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED") { this.db.prepare("UPDATE smithy_jobs SET status = ?, updated_at = ? WHERE event_id = ?").run(status, new Date().toISOString(), eventId); }
  requeue(eventId: string, staleBefore?: string) { return Boolean(this.db.prepare("UPDATE smithy_jobs SET status = 'PENDING', updated_at = ? WHERE event_id = ? AND attempt_count < max_attempts AND (status = 'FAILED' OR (status = 'RUNNING' AND updated_at <= ?))").run(new Date().toISOString(), eventId, staleBefore ?? new Date().toISOString()).changes); }
  cancel(eventId: string) { return Boolean(this.db.prepare("UPDATE smithy_jobs SET status = 'CANCELLED', updated_at = ? WHERE event_id = ? AND status IN ('PENDING', 'RUNNING', 'FAILED')").run(new Date().toISOString(), eventId).changes); }
  pending() { return (this.db.prepare("SELECT * FROM smithy_jobs WHERE status IN ('PENDING', 'RUNNING') ORDER BY created_at").all() as Record<string, unknown>[]).map((row) => this.map(row)); }
  close() { this.db.close(); }
  private map(row: Record<string, unknown>): Job { return { eventId: String(row.event_id), provider: String(row.provider), taskId: String(row.task_id), body: String(row.body), runId: row.run_id ? String(row.run_id) : null, status: row.status as JobStatus, attemptCount: Number(row.attempt_count ?? 0), maxAttempts: Number(row.max_attempts ?? 3), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
}

const pathModuleDir = (file: string) => path.dirname(path.resolve(file));

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly forceRequests = new Map<string, { provider: string; taskId: string; eventId: string }>();
  accept(eventId: string, provider: string, taskId: string, body: string) { const existing = this.jobs.get(eventId); if (existing) return { job: existing, duplicate: true }; const now = new Date().toISOString(); const job: Job = { eventId, provider, taskId, body, runId: null, status: "PENDING", attemptCount: 0, maxAttempts: 3, createdAt: now, updatedAt: now }; this.jobs.set(eventId, job); return { job, duplicate: false }; }
  force(requestId: string, provider: string, taskId: string, eventId: string): ForceResult { const forced = this.forceRequests.get(requestId); if (forced) { if (forced.provider !== provider || forced.taskId !== taskId || forced.eventId !== eventId) return { status: "not_found" }; const duplicate = this.jobs.get(forced.eventId); return duplicate ? { status: "duplicate", job: duplicate } : { status: "not_found" }; } const job = this.jobs.get(eventId); if (!job || job.provider !== provider || job.taskId !== taskId) return { status: "not_found" }; if (job.status !== "FAILED") return { status: "not_failed" }; this.forceRequests.set(requestId, { provider, taskId, eventId }); job.status = "PENDING"; job.maxAttempts = Math.max(job.maxAttempts, job.attemptCount + 1); job.updatedAt = new Date().toISOString(); return { status: "accepted", job }; }
  setRunId(eventId: string, runId: string) { const job = this.jobs.get(eventId); if (job) { job.runId = runId; job.updatedAt = new Date().toISOString(); } }
  markRunning(eventId: string) { const job = this.jobs.get(eventId); if (job && ["PENDING", "RUNNING"].includes(job.status) && job.attemptCount < job.maxAttempts) { job.status = "RUNNING"; job.attemptCount += 1; job.updatedAt = new Date().toISOString(); } }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED") { const job = this.jobs.get(eventId); if (job) { job.status = status; job.updatedAt = new Date().toISOString(); } }
  requeue(eventId: string, staleBefore?: string) { const job = this.jobs.get(eventId); if (!job || job.attemptCount >= job.maxAttempts || !(job.status === "FAILED" || (job.status === "RUNNING" && (!staleBefore || job.updatedAt <= staleBefore)))) return false; job.status = "PENDING"; job.updatedAt = new Date().toISOString(); return true; }
  cancel(eventId: string) { const job = this.jobs.get(eventId); if (!job || !["PENDING", "RUNNING", "FAILED"].includes(job.status)) return false; job.status = "CANCELLED"; job.updatedAt = new Date().toISOString(); return true; }
  pending() { return [...this.jobs.values()].filter((job) => job.status === "PENDING" || job.status === "RUNNING"); }
}
