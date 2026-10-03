import { KeyRound, Trash2, X } from "lucide-react";
import type { RevokeTokenConfirmModalProps } from "./types";
import styles from "./RevokeTokenConfirmModal.module.css";

export function RevokeTokenConfirmModal({ token, busy, onClose, onConfirm }: RevokeTokenConfirmModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="revoke-token-title">
        <header>
          <span className={styles.icon}><Trash2 /></span>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close revoke token confirmation"><X /></button>
        </header>
        <h2 id="revoke-token-title">Revoke API token?</h2>
        <p>Any agent using this token will immediately lose access. This cannot be undone.</p>
        <div className={styles.summary}>
          <span className={styles.summaryIcon}><KeyRound /></span>
          <span>
            <strong>{token.name}</strong>
            <small>tf_{token.prefix}_…</small>
          </span>
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button button-delete" onClick={onConfirm} disabled={busy}>
            <Trash2 /> {busy ? "Revoking…" : "Revoke token"}
          </button>
        </footer>
      </section>
    </div>
  );
}
