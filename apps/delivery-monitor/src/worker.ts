import type { DeliveryMonitorConfig } from "@taskforge/contracts";
import type { MonitorCheckpoint, MonitorStore } from "./persistence.js";

export type MonitorItem = { runId: string; taskId: string; pullRequestUrl: string; status?: string; approvalStatus?: string; availableStatuses?: readonly string[] };
export type PollResult = { cursor?: string | null; etag?: string | null; state: string; observedAt: string; errorCategory?: string | null };
export type MonitorWorkerOptions = { store: MonitorStore; ownerId: string; config: Pick<DeliveryMonitorConfig, "pollIntervalMs" | "batchSize" | "leaseDurationMs" | "maxRetries">; list: (cursor: string | null, limit: number) => Promise<MonitorItem[]>; poll: (item: MonitorItem, checkpoint: MonitorCheckpoint | null) => Promise<PollResult>; onResult?: (item: MonitorItem, result: PollResult) => Promise<void>; onError?: (category: "LEASE" | "CHECKPOINT" | "POLL" | "UNKNOWN" | "AUTHENTICATION" | "PERMISSION" | "RATE_LIMIT" | "NOT_FOUND" | "NETWORK" | "TIMEOUT") => void; onAudit?: (event: "SYNC_STARTED" | "SYNC_COMPLETED" | "SYNC_FAILED" | "LEASE_UNAVAILABLE", item?: MonitorItem) => void };

/** A bounded sweep. Lease acquisition is the concurrency boundary; checkpoint writes are idempotent upserts. */
export async function runSweep(options: MonitorWorkerOptions): Promise<number> {
  const { store, ownerId, config } = options;
  const items = await options.list(null, config.batchSize);
  let processed = 0;
  for (const item of items.slice(0, config.batchSize)) {
    const now = new Date();
    const lease = await store.acquireLease(item.runId, ownerId, now.toISOString(), new Date(now.getTime() + config.leaseDurationMs).toISOString());
    if (!lease) { options.onAudit?.("LEASE_UNAVAILABLE", item); continue; }
    let checkpoint: MonitorCheckpoint | null = null;
    try {
      checkpoint = await store.load(item.runId, item.taskId, item.pullRequestUrl);
      if (checkpoint?.nextAttemptAt && Date.parse(checkpoint.nextAttemptAt) > Date.now()) continue;
      if ((checkpoint?.retryCount ?? 0) >= config.maxRetries && checkpoint?.lastError) continue;
      options.onAudit?.("SYNC_STARTED", item);
      const result = await options.poll(item, checkpoint);
      await options.onResult?.(item, result);
      await store.save({ runId: item.runId, taskId: item.taskId, pullRequestUrl: item.pullRequestUrl, cursor: result.cursor ?? checkpoint?.cursor ?? null, etag: result.etag ?? checkpoint?.etag ?? null, lastState: result.state, observedAt: result.observedAt, retryCount: result.errorCategory ? (checkpoint?.retryCount ?? 0) + 1 : 0, nextAttemptAt: result.errorCategory ? new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** (checkpoint?.retryCount ?? 0))).toISOString() : null, lastError: result.errorCategory ?? null });
      processed += 1;
      options.onAudit?.("SYNC_COMPLETED", item);
    } catch (error) { const category = error instanceof Error && "category" in error ? String((error as { category: unknown }).category) : "UNKNOWN"; options.onError?.(category as Parameters<NonNullable<MonitorWorkerOptions["onError"]>>[0]); options.onAudit?.("SYNC_FAILED", item); try { await store.save({ runId: item.runId, taskId: item.taskId, pullRequestUrl: item.pullRequestUrl, cursor: checkpoint?.cursor ?? null, etag: checkpoint?.etag ?? null, lastState: checkpoint?.lastState ?? "UNKNOWN", observedAt: new Date().toISOString(), retryCount: (checkpoint?.retryCount ?? 0) + 1, nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** (checkpoint?.retryCount ?? 0))).toISOString(), lastError: category }); } catch { options.onError?.("CHECKPOINT"); } }
    finally { await store.releaseLease(item.runId, ownerId); }
  }
  return processed;
}

export async function runWorker(options: MonitorWorkerOptions, signal?: AbortSignal): Promise<void> {
  await options.store.migrate();
  do { await runSweep(options); if (signal?.aborted) break; await new Promise<void>((resolve) => { const timer = setTimeout(resolve, options.config.pollIntervalMs); signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); } while (!signal?.aborted);
}
