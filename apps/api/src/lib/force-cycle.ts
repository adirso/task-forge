import { resolveWebhookDestination, requestWebhook, signWebhookPayload } from "./webhook.js";
import type { WebhookAddressResolver, WebhookRequest } from "./webhook.js";

export type ForceCyclePayload = { id: string; taskId: string; eventId: string; priorCount: number; newLimit: number };

export interface ForceCycleDispatchOptions {
  request?: WebhookRequest;
  resolveAddresses?: WebhookAddressResolver;
  now?: () => number;
}

export async function dispatchForceCycle(
  webhookUrl: string,
  secret: string,
  secretVersion: number,
  payload: ForceCyclePayload,
  options: ForceCycleDispatchOptions = {},
) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor((options.now ?? Date.now)() / 1_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const target = new URL(webhookUrl);
    target.pathname = `${target.pathname.replace(/\/+$/, "")}/force-cycle`;
    const destination = await resolveWebhookDestination(target.toString(), options.resolveAddresses);
    const response = await (options.request ?? requestWebhook)(destination, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": payload.id, "X-TaskForge-Secret-Version": String(secretVersion), "X-TaskForge-Signature": `t=${timestamp},v1=${signWebhookPayload(secret, timestamp, body)}` }, body, signal: controller.signal });
    if (response.status < 200 || response.status >= 300) throw new Error("Non-success status");
  } catch {
    throw new Error("Smithy could not start the additional cycle");
  } finally {
    clearTimeout(timeout);
  }
}
