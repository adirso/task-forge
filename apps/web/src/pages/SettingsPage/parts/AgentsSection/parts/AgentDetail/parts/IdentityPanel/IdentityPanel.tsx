import { Avatar } from "../../../../../../../../components/Avatar";
import type { IdentityPanelProps } from "./types";
import styles from "./IdentityPanel.module.css";

export function IdentityPanel({ agent, avatarUploading, onUpdateAgentAvatar, onRemoveAgentAvatar }: IdentityPanelProps) {
  return (
    <section className={styles.root} role="tabpanel" aria-label="Identity">
      <header className={styles.heading}>
        <h3>Identity</h3>
        <p>Name and profile picture for this agent.</p>
      </header>
      <div className={styles.identity}>
        <Avatar user={agent} size="lg" />
        <div className={styles.copy}>
          <strong>{agent.name}</strong>
          <small>{agent.email || "No email on file"}</small>
        </div>
        <div className={styles.actions}>
          <label className="button button-secondary">
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              aria-label="Change agent picture"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onUpdateAgentAvatar(file);
                event.currentTarget.value = "";
              }}
            />
            {avatarUploading ? "Uploading…" : "Change picture"}
          </label>
          {agent.avatarUrl && (
            <button type="button" className="button button-secondary" disabled={avatarUploading} onClick={() => void onRemoveAgentAvatar()}>
              Remove picture
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
