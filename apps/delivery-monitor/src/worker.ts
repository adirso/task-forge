import type { DeliveryMonitorConfig } from "@taskforge/contracts";
import type { MonitorCheckpoint, MonitorStore } from "./persistence.js";

export type MonitorItem = { runId: string; taskId: string; pullRequestUrl: string };
export type PollResult = { cursor?: string | null; etag?: string | null; state: string; observedAt: string; errorCategory?: string | null };
export type MonitorWorkerOptions = { store: MonitorStore; ownerId: string; config: Pick<DeliveryMonitorConfig, "pollIntervalMs" | "batchSize" | "leaseDurationMs">; list: (cursor: string | null, limit: number) => Promise<MonitorItem[]>; poll: (item: MonitorItem, checkpoint: MonitorCheckpoint | null) => Promise<PollResult>; onError?: (error: unknown) => void };

/** A bounded sweep. Lease acquisition is the concurrency boundary; checkpoint writes are idempotent upserts. */
export async function runSweep(options: MonitorWorkerOptions): Promise<number> {
  const { store, ownerId, config } = options;
  const items = await options.list(null, config.batchSize);
  let processed = 0;
  for (const item of items.slice(0, config.batchSize)) {
    const now = new Date();
    const lease = await store.acquireLease(item.runId, ownerId, now.toISOString(), new Date(now.getTime() + config.leaseDurationMs).toISOString());
    if (!lease) continue;
    try {
      const checkpoint = await store.load(item.runId, item.taskId, item.pullRequestUrl);
      if (checkpoint?.nextAttemptAt && Date.parse(checkpoint.nextAttemptAt) > Date.now()) continue;
      const result = await options.poll(item, checkpoint);
      await store.save({ runId: item.runId, taskId: item.taskId, pullRequestUrl: item.pullRequestUrl, cursor: result.cursor ?? checkpoint?.cursor ?? null, etag: result.etag ?? checkpoint?.etag ?? null, lastState: result.state, observedAt: result.observedAt, retryCount: result.errorCategory ? (checkpoint?.retryCount ?? 0) + 1 : 0, nextAttemptAt: result.errorCategory ? new Date(Date.now() + Math.min(300_000, 1_000 * 2 ** (checkpoint?.retryCount ?? 0))).toISOString() : null, lastError: result.errorCategory ?? null });
      processed += 1;
    } catch (error) { options.onError?.(error); }
    finally { await store.releaseLease(item.runId, ownerId); }
  }
  return processed;
}

export async function runWorker(options: MonitorWorkerOptions, signal?: AbortSignal): Promise<void> {
  await options.store.migrate();
  do { await runSweep(options); if (signal?.aborted) break; await new Promise<void>((resolve) => { const timer = setTimeout(resolve, options.config.pollIntervalMs); signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true }); }); } while (!signal?.aborted);
}
