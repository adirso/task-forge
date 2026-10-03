import { AgentCapabilityEditor } from "../../../../../../../../components/AgentCapabilityEditor";
import type { RoutingPanelProps } from "./types";
import styles from "./RoutingPanel.module.css";

export function RoutingPanel({ agent, onAgentUpdated, onSuccess, onError }: RoutingPanelProps) {
  return (
    <section className={styles.root} role="tabpanel" aria-label="Routing">
      <header className={styles.heading}>
        <h3>Routing</h3>
        <p>Capabilities used for deterministic automatic assignment.</p>
      </header>
      <AgentCapabilityEditor agent={agent} onUpdated={onAgentUpdated} onSuccess={onSuccess} onError={onError} embedded />
    </section>
  );
}
