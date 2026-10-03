import { Plus } from "lucide-react";
import type { NewAgentFormProps } from "./types";
import styles from "./NewAgentForm.module.css";

export function NewAgentForm({
  agentName,
  agentEmail,
  creatingAgent,
  onAgentNameChange,
  onAgentEmailChange,
  onSubmit,
  onCancel,
}: NewAgentFormProps) {
  return (
    <form id="new-agent-form" className={styles.root} onSubmit={onSubmit} aria-label="Create agent identity">
      <h3><Plus /> New agent identity</h3>
      <div className={styles.fields}>
        <label>Name<input value={agentName} onChange={(event) => onAgentNameChange(event.target.value)} placeholder="Repository Builder" required autoComplete="off" /></label>
        <label>Email <span>Optional</span><input type="email" value={agentEmail} onChange={(event) => onAgentEmailChange(event.target.value)} placeholder="builder@example.local" autoComplete="off" /></label>
        <div className={styles.actions}>
          <button type="button" className="button button-secondary" disabled={creatingAgent} onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={creatingAgent}>{creatingAgent ? "Creating…" : "Create agent"}</button>
        </div>
      </div>
    </form>
  );
}
