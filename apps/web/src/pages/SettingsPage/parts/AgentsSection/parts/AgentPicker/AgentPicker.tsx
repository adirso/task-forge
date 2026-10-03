import { Avatar } from "../../../../../../components/Avatar";
import type { AgentPickerProps } from "./types";
import styles from "./AgentPicker.module.css";

export function AgentPicker({ agents, selectedAgentId, onSelectAgent }: AgentPickerProps) {
  return (
    <div className={styles.root} role="listbox" aria-label="Agents">
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          role="option"
          aria-selected={selectedAgentId === agent.id}
          className={`${styles.item}${selectedAgentId === agent.id ? ` ${styles.itemActive}` : ""}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <Avatar user={agent} size="md" />
          <span className={styles.copy}><strong>{agent.name}</strong><small>{agent.email || "No email"}</small></span>
        </button>
      ))}
    </div>
  );
}
