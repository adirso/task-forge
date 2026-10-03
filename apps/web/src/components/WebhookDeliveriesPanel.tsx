import { useEffect, useState } from "react";
import type { User, WebhookDelivery } from "@taskforge/contracts";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { summarizeWebhookDeliveries } from "../lib/webhookDeliveries";

export function WebhookDeliveriesPanel({ agent, onSuccess, onError }: {
  agent: User;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState("");

  useEffect(() => {
    void loadDeliveries();
  }, [agent.id]);

  async function loadDeliveries() {
    setLoading(true);
    try { setDeliveries((await api.webhookDeliveries({ agentId: agent.id, limit: 50 })).deliveries); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load webhook deliveries"); }
    finally { setLoading(false); }
  }

  async function retryDelivery(delivery: WebhookDelivery) {
    setRetryingId(delivery.id);
    try {
      const retried = (await api.retryWebhookDelivery(delivery.id)).delivery;
      setDeliveries((items) => items.map((item) => item.id === retried.id ? retried : item));
      onSuccess("Webhook delivery queued for retry");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not retry webhook delivery"); }
    finally { setRetryingId(""); }
  }

  const summary = deliveries.length ? summarizeWebhookDeliveries(deliveries) : "";

  return (
    <section className="webhook-deliveries webhook-deliveries-panel">
      <header>
        <span>
          <strong>Recent deliveries</strong>
          <small>{summary || "Stable event IDs let receivers safely deduplicate retries."}</small>
        </span>
        <button type="button" className="icon-button" title="Refresh deliveries" disabled={loading} onClick={() => void loadDeliveries()}>
          <RefreshCw />
        </button>
      </header>
      {!deliveries.length ? (
        <p className="no-tokens">{loading ? "Loading deliveries…" : "No webhook deliveries for this agent yet."}</p>
      ) : (
        <div className="webhook-deliveries-list" role="list">
          {deliveries.map((delivery) => (
            <article key={delivery.id} role="listitem">
              <span className={`webhook-delivery-status status-${delivery.status.toLowerCase()}`}>{delivery.status}</span>
              <span>
                <strong>{delivery.eventType}</strong>
                <small>
                  {delivery.projectKey && delivery.taskNumber ? `${delivery.projectKey}-${delivery.taskNumber} · ` : ""}
                  <span title={delivery.id}>{delivery.id}</span>
                  {" · "}
                  {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}
                </small>
                {delivery.lastError && (
                  <small className="webhook-delivery-error">
                    {delivery.lastError}{delivery.httpStatus ? ` (${delivery.httpStatus})` : ""}
                  </small>
                )}
              </span>
              {delivery.status === "FAILED" && (
                <button type="button" className="button button-secondary" disabled={retryingId === delivery.id} onClick={() => void retryDelivery(delivery)}>
                  <RotateCcw /> {retryingId === delivery.id ? "Queueing…" : "Retry"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
