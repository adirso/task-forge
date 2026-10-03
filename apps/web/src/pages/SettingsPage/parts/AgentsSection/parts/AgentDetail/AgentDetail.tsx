import { Check, Copy, Eye, KeyRound, Route, Trash2, UserRound, Webhook } from "lucide-react";
import { Avatar } from "../../../../../../components/Avatar";
import { WebhookManager } from "../../../../../../components/WebhookManager";
import { WebhookDeliveriesPanel } from "../../../../../../components/WebhookDeliveriesPanel";
import { AgentCapabilityEditor } from "../../../../../../components/AgentCapabilityEditor";
import type { AgentDetailProps } from "./types";
import styles from "./AgentDetail.module.css";

function tabClass(active: boolean) {
  return `${styles.tab}${active ? ` ${styles.tabActive}` : ""}`;
}

export function AgentDetail({
  agent,
  agentDetailTab,
  tokens,
  tokensLoading,
  tokensError,
  tokenName,
  expiresInDays,
  issuingToken,
  issuedToken,
  revealedTokenId,
  copied,
  avatarUploading,
  onAgentDetailTabChange,
  onAgentUpdated,
  onSuccess,
  onError,
  onIssueToken,
  onTokenNameChange,
  onExpiresInDaysChange,
  onRequestRevealToken,
  onRevokeToken,
  onCopyToken,
  onUpdateAgentAvatar,
  onRemoveAgentAvatar,
  onDeleteAgent,
}: AgentDetailProps) {
  return (
    <div className={styles.root} aria-label={`${agent.name} settings`}>
      <nav className={styles.tabs} role="tablist" aria-label={`${agent.name} setting sections`}>
        <button type="button" role="tab" aria-selected={agentDetailTab === "identity"} className={tabClass(agentDetailTab === "identity")} onClick={() => onAgentDetailTabChange("identity")}><UserRound /> Identity</button>
        <button type="button" role="tab" aria-selected={agentDetailTab === "access"} className={tabClass(agentDetailTab === "access")} onClick={() => onAgentDetailTabChange("access")}><KeyRound /> Access</button>
        <button type="button" role="tab" aria-selected={agentDetailTab === "deliveries"} className={tabClass(agentDetailTab === "deliveries")} onClick={() => onAgentDetailTabChange("deliveries")}><Webhook /> Deliveries</button>
        <button type="button" role="tab" aria-selected={agentDetailTab === "routing"} className={tabClass(agentDetailTab === "routing")} onClick={() => onAgentDetailTabChange("routing")}><Route /> Routing</button>
        <button type="button" role="tab" aria-selected={agentDetailTab === "danger"} className={tabClass(agentDetailTab === "danger")} onClick={() => onAgentDetailTabChange("danger")}><Trash2 /> Danger zone</button>
      </nav>

      {agentDetailTab === "identity" && (
        <section className={styles.panel} role="tabpanel" aria-label="Identity">
          <header className={styles.panelHeading}>
            <h3>Identity</h3>
            <p>Name and profile picture for this agent.</p>
          </header>
          <div className={styles.identity}>
            <Avatar user={agent} size="lg" />
            <div className={styles.identityCopy}>
              <strong>{agent.name}</strong>
              <small>{agent.email || "No email on file"}</small>
            </div>
            <div className={styles.avatarActions}>
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
      )}

      {agentDetailTab === "access" && (
        <section className={styles.panel} role="tabpanel" aria-label="Access">
          <header className={styles.panelHeading}>
            <h3>Access</h3>
            <p>Webhook endpoint and revocable API tokens. Secrets are shown only when created or revealed.</p>
          </header>
          <WebhookManager agent={agent} onAgentUpdated={onAgentUpdated} onSuccess={onSuccess} onError={onError} />
          <div className="agent-token-block">
            <h4>API tokens</h4>
            <form className="token-form" onSubmit={onIssueToken} aria-label="Issue API token">
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
              <div className="issued-token" role="status">
                <strong>{revealedTokenId ? "Revealed token" : "Copy this token now"}</strong>
                <p>{revealedTokenId ? "Store it securely. You can reveal it again from the list below." : "You can also reveal it later from the issued tokens list."}</p>
                <div>
                  <code>{issuedToken}</code>
                  <button type="button" onClick={() => void onCopyToken()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>
                </div>
              </div>
            )}
            <div className="token-list">
              <h4>Issued tokens</h4>
              {tokensLoading ? <p className="no-tokens" role="status">Loading tokens…</p>
                : tokensError ? <p className="form-error" role="alert">{tokensError}</p>
                : tokens.length ? tokens.map((token) => (
                  <article key={token.id} className={token.revokedAt ? "revoked" : ""}>
                    <KeyRound />
                    <span>
                      <strong>{token.name}</strong>
                      <small>
                        tf_{token.prefix}_… · {token.revokedAt ? "Revoked" : token.lastUsedAt ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}
                        {!token.revokedAt && !token.revealable ? " · Not recoverable" : ""}
                      </small>
                    </span>
                    <div className="token-actions">
                      {!token.revokedAt && token.revealable && (
                        <button type="button" className="reveal-token" onClick={() => onRequestRevealToken(token)} title={`Reveal ${token.name}`} aria-label={`Reveal ${token.name}`}>
                          <Eye />
                        </button>
                      )}
                      {!token.revokedAt && (
                        <button type="button" onClick={() => void onRevokeToken(token.id)} title="Revoke token" aria-label={`Revoke ${token.name}`}>
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </article>
                )) : <p className="no-tokens">No tokens issued for this agent.</p>}
            </div>
          </div>
        </section>
      )}

      {agentDetailTab === "deliveries" && (
        <section className={`${styles.panel} ${styles.panelDeliveries}`} role="tabpanel" aria-label="Deliveries">
          <header className={styles.panelHeading}>
            <h3>Deliveries</h3>
            <p>Inspect and retry webhook delivery attempts for this agent.</p>
          </header>
          <WebhookDeliveriesPanel agent={agent} onSuccess={onSuccess} onError={onError} />
        </section>
      )}

      {agentDetailTab === "routing" && (
        <section className={styles.panel} role="tabpanel" aria-label="Routing">
          <header className={styles.panelHeading}>
            <h3>Routing</h3>
            <p>Capabilities used for deterministic automatic assignment.</p>
          </header>
          <AgentCapabilityEditor agent={agent} onUpdated={onAgentUpdated} onSuccess={onSuccess} onError={onError} embedded />
        </section>
      )}

      {agentDetailTab === "danger" && (
        <section className={`${styles.panel} ${styles.panelDanger}`} role="tabpanel" aria-label="Danger zone">
          <header className={styles.panelHeading}>
            <h3>Danger zone</h3>
            <p>Deleting an agent revokes every token and removes the identity.</p>
          </header>
          <button type="button" className="button button-danger-quiet" onClick={() => { void onDeleteAgent(); }}>
            <Trash2 /> Delete {agent.name}
          </button>
        </section>
      )}
    </div>
  );
}
