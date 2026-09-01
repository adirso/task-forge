import { signWebhookPayload } from "./webhook.js";

export type ForceCyclePayload = { id: string; taskId: string; eventId: string; priorCount: number; newLimit: number };

export async function dispatchForceCycle(
  webhookUrl: string,
  secret: string,
  secretVersion: number,
  payload: ForceCyclePayload,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(now() / 1_000);
  const target = `${webhookUrl.replace(/\/$/, "")}/force-cycle`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(target, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": payload.id, "X-TaskForge-Secret-Version": String(secretVersion), "X-TaskForge-Signature": `t=${timestamp},v1=${signWebhookPayload(secret, timestamp, body)}` }, body, signal: controller.signal });
    if (!response.ok) throw new Error(`Smithy force-cycle endpoint returned HTTP ${response.status}`);
  } catch {
    throw new Error("Smithy could not start the additional cycle");
  } finally {
    clearTimeout(timeout);
  }
}
