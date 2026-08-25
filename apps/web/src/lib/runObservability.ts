import type { AgentLog, AgentRun } from "./api";

export type RunHealthKind = "LIVE" | "WAITING" | "STALE" | "TIMED_OUT" | "FAILED" | "COMPLETED" | "CANCELLED";
export interface RunHealth { kind: RunHealthKind; label: string; detail: string; stale: boolean; }

const WAITING_PATTERN = /\b(waiting|awaiting|permission|approval|input|prompt)\b/i;

export function getRunHealth(run: AgentRun, now = Date.now()): RunHealth {
  if (run.status === "SUCCEEDED") return { kind: "COMPLETED", label: "Completed", detail: "Provider run completed", stale: false };
  if (run.status === "FAILED") return { kind: "FAILED", label: "Failed", detail: run.lastError || "Provider run failed", stale: true };
  if (run.status === "CANCELLED") return { kind: "CANCELLED", label: "Cancelled", detail: "Run was cancelled", stale: false };
  if (run.timeoutAt && Date.parse(run.timeoutAt) <= now) return { kind: "TIMED_OUT", label: "Timed out", detail: "The configured run timeout has elapsed", stale: true };
  if (run.status === "PENDING") return { kind: "WAITING", label: "Waiting to start", detail: "Queued for a provider", stale: false };
  if (run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) <= now) return { kind: "STALE", label: "Lease expired", detail: "No active lease is holding this run", stale: true };
  const lastSignal = run.heartbeatAt || run.updatedAt;
  if (now - Date.parse(lastSignal) > 75_000) return { kind: "STALE", label: "Heartbeat stale", detail: `Last activity ${formatAge(now - Date.parse(lastSignal))} ago`, stale: true };
  return { kind: "LIVE", label: "Live", detail: run.heartbeatAt ? `Heartbeat ${formatAge(now - Date.parse(run.heartbeatAt))} ago` : "Waiting for first heartbeat", stale: false };
}

export function latestRunLog(logs: AgentLog[], runId: string): AgentLog | null {
  return runLogs(logs, runId)[0] ?? null;
}

export function runLogs(logs: AgentLog[], runId: string, limit = 5): AgentLog[] {
  return logs.filter((log) => log.runId === runId).sort((a, b) => b.sequence - a.sequence || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
}

export function runIsWaitingForInput(log: AgentLog | null): boolean {
  return Boolean(log && WAITING_PATTERN.test(log.content));
}

export function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatCountdown(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const remaining = Date.parse(iso) - now;
  return remaining <= 0 ? "expired" : `${formatAge(remaining)} remaining`;
}
