import { useEffect, useState } from "react";
import type { WebhookDelivery } from "@taskforge/contracts";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../../lib/api";
import { summarizeWebhookDeliveries } from "../../lib/webhookDeliveries";
import type { WebhookDeliveriesPanelProps } from "./types";
import styles from "./WebhookDeliveriesPanel.module.css";

function statusClass(status: WebhookDelivery["status"]) {
  const key = status.toLowerCase();
  if (key === "delivered") return `${styles.status} ${styles.statusDelivered}`;
  if (key === "failed") return `${styles.status} ${styles.statusFailed}`;
  return `${styles.status} ${styles.statusPending}`;
}

export function WebhookDeliveriesPanel({ agent, onSuccess, onError }: WebhookDeliveriesPanelProps) {
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
    <section className={styles.root}>
      <header className={styles.header}>
        <span className={styles.headerCopy}>
          <strong>Recent deliveries</strong>
          <small>{summary || "Stable event IDs let receivers safely deduplicate retries."}</small>
        </span>
        <button type="button" className={styles.refresh} title="Refresh deliveries" disabled={loading} onClick={() => void loadDeliveries()}>
          <RefreshCw />
        </button>
      </header>
      {!deliveries.length ? (
        <p className={styles.empty}>{loading ? "Loading deliveries…" : "No webhook deliveries for this agent yet."}</p>
      ) : (
        <div className={styles.list} role="list">
          {deliveries.map((delivery) => (
            <article key={delivery.id} className={styles.item} role="listitem">
              <span className={statusClass(delivery.status)}>{delivery.status}</span>
              <span className={styles.itemBody}>
                <strong>{delivery.eventType}</strong>
                <small>
                  {delivery.projectKey && delivery.taskNumber ? `${delivery.projectKey}-${delivery.taskNumber} · ` : ""}
                  <span title={delivery.id}>{delivery.id}</span>
                  {" · "}
                  {delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}
                </small>
                {delivery.lastError && (
                  <small className={styles.error}>
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
