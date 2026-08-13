/** Fire-and-forget HTTP POST to a webhook URL. Errors are silently discarded. */
export function dispatchWebhook(url: string, payload: unknown): void {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(() => clearTimeout(timeout))
    .catch(() => clearTimeout(timeout));
}
