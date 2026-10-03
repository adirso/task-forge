import { Eye, KeyRound, X } from "lucide-react";
import type { RevealTokenConfirmModalProps } from "./types";
import styles from "./RevealTokenConfirmModal.module.css";

export function RevealTokenConfirmModal({ token, busy, onClose, onConfirm }: RevealTokenConfirmModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="reveal-token-title">
        <header>
          <span className={styles.icon}><Eye /></span>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close reveal token confirmation"><X /></button>
        </header>
        <h2 id="reveal-token-title">Reveal API token?</h2>
        <p>Anyone with this value can act as the agent. Reveal it only if you need to copy it again.</p>
        <div className={styles.summary}>
          <span className={styles.summaryIcon}><KeyRound /></span>
          <span>
            <strong>{token.name}</strong>
            <small>tf_{token.prefix}_…</small>
          </span>
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={busy}>
            <Eye /> {busy ? "Revealing…" : "Reveal token"}
          </button>
        </footer>
      </section>
    </div>
  );
}
