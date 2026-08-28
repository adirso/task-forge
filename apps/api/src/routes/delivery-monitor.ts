import type { FastifyInstance } from "fastify";
import { deliveryMonitorHealthSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";

/**
 * Read-only, authenticated diagnostics for the optional Delivery Monitor.
 * The worker owns these tables; this surface deliberately never mutates them
 * or performs a status transition.
 */
export async function deliveryMonitorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  const unitOfWork = createUnitOfWork(db);

  app.get("/health", { schema: { tags: ["Delivery Monitor"], summary: "Delivery Monitor liveness and checkpoint diagnostics" } }, async (_request, reply) => {
    try {
      const now = new Date().toISOString();
      const result = await unitOfWork.run((repositories) => repositories.deliveryMonitor.health(now, Math.max(5_000, Number(process.env.DELIVERY_MONITOR_POLL_INTERVAL_MS ?? 60_000))));
      const health = deliveryMonitorHealthSchema.parse({
        status: result.status, lastSweepAt: result.lastSweepAt, activeLeaseCount: result.activeLeaseCount,
        processedCount: result.processedCount, nextRetryAt: result.nextRetryAt, failures: result.failures,
      });
      return { monitor: health, activeLeases: result.activeLeases };
    } catch {
      // Do not leak SQL, paths, credentials, or driver diagnostics.
      return reply.code(503).send({ monitor: { status: "unavailable", errorCategory: "CHECKPOINT_STORAGE" } });
    }
  });

  app.get<{ Params: { taskId: string } }>("/tasks/:taskId", { schema: { tags: ["Delivery Monitor"], summary: "Task-specific Delivery Monitor checkpoint" } }, async (request, reply) => {
    try {
      const checkpoint = await unitOfWork.run((repositories) => repositories.deliveryMonitor.taskCheckpoint(request.params.taskId));
      return { checkpoint: checkpoint ?? null };
    } catch {
      return reply.code(503).send({ error: "Delivery Monitor checkpoint storage is unavailable", errorCategory: "CHECKPOINT_STORAGE" });
    }
  });
}
