import type { WebhookDelivery } from "@taskforge/contracts";
import type { RequestContext } from "./context.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { WebhookDeliveryEntity } from "./models.js";
import type { UnitOfWork } from "./repositories.js";
import type { WebhookDeliveryService } from "./services.js";

function response(delivery: WebhookDeliveryEntity): WebhookDelivery {
  return {
    id: delivery.id,
    agentId: delivery.agentId,
    agentName: delivery.agentName ?? "Unknown agent",
    taskId: delivery.taskId,
    taskNumber: delivery.taskNumber ?? null,
    projectKey: delivery.projectKey ?? null,
    eventType: delivery.eventType,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    nextAttemptAt: delivery.nextAttemptAt,
    lastAttemptAt: delivery.lastAttemptAt,
    deliveredAt: delivery.deliveredAt,
    failedAt: delivery.failedAt,
    lastError: delivery.lastError,
    httpStatus: delivery.httpStatus,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

export class WebhookDeliveryApplicationService implements WebhookDeliveryService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString()) {}

  async list(context: RequestContext, filters: Parameters<WebhookDeliveryService["list"]>[1]) {
    if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required");
    return this.unitOfWork.run(async (repositories) => (await repositories.webhookDeliveries.list(filters)).map(response));
  }

  async retry(context: RequestContext, deliveryId: string) {
    if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required");
    return this.unitOfWork.run(async (repositories) => {
      const delivery = await repositories.webhookDeliveries.findById(deliveryId);
      if (!delivery) throw new NotFoundError("Webhook delivery");
      if (delivery.status !== "FAILED") throw new ValidationError("Only terminally failed webhook deliveries can be retried");
      if (!(await repositories.webhookDeliveries.retry(deliveryId, this.now()))) throw new ConflictError("Webhook delivery status changed before it could be retried");
      const retried = await repositories.webhookDeliveries.findById(deliveryId);
      if (!retried) throw new NotFoundError("Webhook delivery");
      return response(retried);
    });
  }
}
