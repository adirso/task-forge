import type { FastifyInstance } from "fastify";
import { deliveryMonitorHealthSchema } from "@taskforge/contracts";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { DeliveryMonitorApplicationService } from "../application/delivery-monitor-service.js";

/**
 * Read-only, authenticated diagnostics for the optional Delivery Monitor.
 * The worker owns these tables; this surface deliberately never mutates them
 * or performs a status transition.
 */
export async function deliveryMonitorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);
  const service = new DeliveryMonitorApplicationService(createUnitOfWork(db));
  const context = (request: { authUser: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER"; name: string; tokenScopes: string[] | null } }) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes as import("../application/context.js").TokenScope[] | null } });

  app.get("/health", { schema: { tags: ["Delivery Monitor"], summary: "Delivery Monitor liveness and checkpoint diagnostics" } }, async (request, reply) => {
    try {
      const result = await service.health(context(request), Math.max(5_000, Number(process.env.DELIVERY_MONITOR_POLL_INTERVAL_MS ?? 60_000)));
      const health = deliveryMonitorHealthSchema.parse({
        status: result.status, lastSweepAt: result.lastSweepAt, activeLeaseCount: result.activeLeaseCount,
        processedCount: result.processedCount, nextRetryAt: result.nextRetryAt, failures: result.failures,
      });
      return { monitor: health, activeLeases: result.activeLeases };
    } catch {
      // Do not leak SQL, paths, credentials, or driver diagnostics.
      return reply.code(503).send({ monitor: { status: "unavailable", lastSweepAt: null, activeLeaseCount: 0, processedCount: 0, nextRetryAt: null, failures: [] }, errorCategory: "CHECKPOINT_STORAGE" });
    }
  });

  app.get<{ Params: { taskId: string } }>("/tasks/:taskId", { schema: { tags: ["Delivery Monitor"], summary: "Task-specific Delivery Monitor checkpoint" } }, async (request) => {
    const checkpoint = await service.taskCheckpoint(context(request), request.params.taskId);
    return { checkpoint: checkpoint ?? null };
  });
}
