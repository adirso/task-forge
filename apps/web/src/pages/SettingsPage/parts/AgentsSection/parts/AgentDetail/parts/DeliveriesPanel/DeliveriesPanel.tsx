import { WebhookDeliveriesPanel } from "../../../../../../../../components/WebhookDeliveriesPanel";
import type { DeliveriesPanelProps } from "./types";
import styles from "./DeliveriesPanel.module.css";

export function DeliveriesPanel({ agent, onSuccess, onError }: DeliveriesPanelProps) {
  return (
    <section className={styles.root} role="tabpanel" aria-label="Deliveries">
      <header className={styles.heading}>
        <h3>Deliveries</h3>
        <p>Inspect and retry webhook delivery attempts for this agent.</p>
      </header>
      <WebhookDeliveriesPanel agent={agent} onSuccess={onSuccess} onError={onError} />
    </section>
  );
}
