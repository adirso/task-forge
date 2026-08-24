import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export interface Job { eventId: string; provider: string; taskId: string; body: string; status: JobStatus; createdAt: string; updatedAt: string; }
export interface JobStore { accept(eventId: string, provider: string, taskId: string, body: string): { job: Job; duplicate: boolean }; markRunning(eventId: string): void; markComplete(eventId: string, status: "SUCCEEDED" | "FAILED"): void; pending(): Job[]; close?(): void; }

export class SqliteJobStore implements JobStore {
  private readonly db: Database.Database;
  constructor(path = process.env.SMITHY_DB_PATH ?? "./data/smithy.sqlite") {
    mkdirSync(pathModuleDir(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS smithy_jobs (event_id TEXT PRIMARY KEY, provider TEXT NOT NULL, task_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  }
  accept(eventId: string, provider: string, taskId: string, body: string) {
    const existing = this.db.prepare("SELECT * FROM smithy_jobs WHERE event_id = ?").get(eventId) as Record<string, unknown> | undefined;
    if (existing) return { job: this.map(existing), duplicate: true };
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO smithy_jobs (event_id, provider, task_id, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)").run(eventId, provider, taskId, body, now, now);
    const job: Job = { eventId, provider, taskId, body, status: "PENDING", createdAt: now, updatedAt: now };
    return { job, duplicate: false };
  }
  markRunning(eventId: string) { this.db.prepare("UPDATE smithy_jobs SET status = 'RUNNING', updated_at = ? WHERE event_id = ? AND status IN ('PENDING', 'RUNNING')").run(new Date().toISOString(), eventId); }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED") { this.db.prepare("UPDATE smithy_jobs SET status = ?, updated_at = ? WHERE event_id = ?").run(status, new Date().toISOString(), eventId); }
  pending() { return (this.db.prepare("SELECT * FROM smithy_jobs WHERE status IN ('PENDING', 'RUNNING') ORDER BY created_at").all() as Record<string, unknown>[]).map((row) => this.map(row)); }
  close() { this.db.close(); }
  private map(row: Record<string, unknown>): Job { return { eventId: String(row.event_id), provider: String(row.provider), taskId: String(row.task_id), body: String(row.body), status: row.status as JobStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
}

const pathModuleDir = (file: string) => path.dirname(path.resolve(file));

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();
  accept(eventId: string, provider: string, taskId: string, body: string) { const existing = this.jobs.get(eventId); if (existing) return { job: existing, duplicate: true }; const now = new Date().toISOString(); const job = { eventId, provider, taskId, body, status: "PENDING" as const, createdAt: now, updatedAt: now }; this.jobs.set(eventId, job); return { job, duplicate: false }; }
  markRunning(eventId: string) { const job = this.jobs.get(eventId); if (job) job.status = "RUNNING"; }
  markComplete(eventId: string, status: "SUCCEEDED" | "FAILED") { const job = this.jobs.get(eventId); if (job) job.status = status; }
  pending() { return [...this.jobs.values()].filter((job) => job.status === "PENDING" || job.status === "RUNNING"); }
}
