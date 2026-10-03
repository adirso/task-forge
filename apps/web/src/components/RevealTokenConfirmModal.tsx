import type { ApiTokenMetadata } from "@taskforge/contracts";
import { Eye, KeyRound, X } from "lucide-react";

export function RevealTokenConfirmModal({ token, busy, onClose, onConfirm }: {
  token: ApiTokenMetadata;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="reveal-token-title">
        <header>
          <span className="logout-icon reveal-token-icon"><Eye /></span>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close reveal token confirmation"><X /></button>
        </header>
        <h2 id="reveal-token-title">Reveal API token?</h2>
        <p>Anyone with this value can act as the agent. Reveal it only if you need to copy it again.</p>
        <div className="logout-user-summary">
          <span className="reveal-token-summary-icon"><KeyRound /></span>
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
