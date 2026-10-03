import { Check, Copy, Eye, KeyRound, Trash2 } from "lucide-react";
import { WebhookManager } from "../../../../../../../../components/WebhookManager";
import type { AccessPanelProps } from "./types";
import styles from "./AccessPanel.module.css";

export function AccessPanel({
  agent,
  tokens,
  tokensLoading,
  tokensError,
  tokenName,
  expiresInDays,
  issuingToken,
  issuedToken,
  revealedTokenId,
  copied,
  onAgentUpdated,
  onSuccess,
  onError,
  onIssueToken,
  onTokenNameChange,
  onExpiresInDaysChange,
  onRequestRevealToken,
  onRevokeToken,
  onCopyToken,
}: AccessPanelProps) {
  return (
    <section className={styles.root} role="tabpanel" aria-label="Access">
      <header className={styles.heading}>
        <h3>Access</h3>
        <p>Webhook endpoint and revocable API tokens. Secrets are shown only when created or revealed.</p>
      </header>
      <WebhookManager agent={agent} onAgentUpdated={onAgentUpdated} onSuccess={onSuccess} onError={onError} />
      <div className={styles.tokenBlock}>
        <h4>API tokens</h4>
        <form className={styles.form} onSubmit={onIssueToken} aria-label="Issue API token">
          <label>Token name<input value={tokenName} onChange={(event) => onTokenNameChange(event.target.value)} required /></label>
          <label>Expires after
            <select value={expiresInDays} onChange={(event) => onExpiresInDaysChange(event.target.value)}>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="">Never</option>
            </select>
          </label>
          <button type="submit" className="button button-primary" disabled={issuingToken}><KeyRound /> {issuingToken ? "Issuing…" : "Issue token"}</button>
        </form>
        {issuedToken && (
          <div className={styles.issued} role="status">
            <strong>{revealedTokenId ? "Revealed token" : "Copy this token now"}</strong>
            <p>{revealedTokenId ? "Store it securely. You can reveal it again from the list below." : "You can also reveal it later from the issued tokens list."}</p>
            <div>
              <code>{issuedToken}</code>
              <button type="button" onClick={() => void onCopyToken()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
        )}
        <div className={styles.list}>
          <h4>Issued tokens</h4>
          {tokensLoading ? <p className={styles.empty} role="status">Loading tokens…</p>
            : tokensError ? <p className="form-error" role="alert">{tokensError}</p>
            : tokens.length ? tokens.map((token) => (
              <article key={token.id} className={`${styles.item}${token.revokedAt ? ` ${styles.itemRevoked}` : ""}`}>
                <KeyRound />
                <span>
                  <strong>{token.name}</strong>
                  <small>
                    tf_{token.prefix}_… · {token.revokedAt ? "Revoked" : token.lastUsedAt ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}
                    {!token.revokedAt && !token.revealable ? " · Not recoverable" : ""}
                  </small>
                </span>
                <div className={styles.actions}>
                  {!token.revokedAt && token.revealable && (
                    <button type="button" className={styles.reveal} onClick={() => onRequestRevealToken(token)} title={`Reveal ${token.name}`} aria-label={`Reveal ${token.name}`}>
                      <Eye />
                    </button>
                  )}
                  {!token.revokedAt && (
                    <button type="button" className={styles.revoke} onClick={() => void onRevokeToken(token.id)} title="Revoke token" aria-label={`Revoke ${token.name}`}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              </article>
            )) : <p className={styles.empty}>No tokens issued for this agent.</p>}
        </div>
      </div>
    </section>
  );
}
