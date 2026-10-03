import type { WebhookDelivery } from "@taskforge/contracts";

export function summarizeWebhookDeliveries(deliveries: WebhookDelivery[]): string {
  const failed = deliveries.filter((delivery) => delivery.status === "FAILED").length;
  const pending = deliveries.filter((delivery) => delivery.status === "PENDING" || delivery.status === "RETRYING").length;
  const delivered = deliveries.filter((delivery) => delivery.status === "DELIVERED").length;
  const parts = [`${deliveries.length} recent`];
  if (failed) parts.push(`${failed} failed`);
  else if (pending) parts.push(`${pending} pending`);
  else if (delivered) parts.push(`${delivered} delivered`);
  return parts.join(" · ");
}
