import { Trash2 } from "lucide-react";
import type { DangerPanelProps } from "./types";
import styles from "./DangerPanel.module.css";

export function DangerPanel({ agentName, onDeleteAgent }: DangerPanelProps) {
  return (
    <section className={styles.root} role="tabpanel" aria-label="Danger zone">
      <header className={styles.heading}>
        <h3>Danger zone</h3>
        <p>Deleting an agent revokes every token and removes the identity.</p>
      </header>
      <button type="button" className="button button-danger-quiet" onClick={() => { void onDeleteAgent(); }}>
        <Trash2 /> Delete {agentName}
      </button>
    </section>
  );
}
