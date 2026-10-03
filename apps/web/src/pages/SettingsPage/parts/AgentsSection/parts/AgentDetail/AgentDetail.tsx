import { KeyRound, Route, Trash2, UserRound, Webhook } from "lucide-react";
import { IdentityPanel } from "./parts/IdentityPanel";
import { AccessPanel } from "./parts/AccessPanel";
import { DeliveriesPanel } from "./parts/DeliveriesPanel";
import { RoutingPanel } from "./parts/RoutingPanel";
import { DangerPanel } from "./parts/DangerPanel";
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
        <IdentityPanel
          agent={agent}
          avatarUploading={avatarUploading}
          onUpdateAgentAvatar={onUpdateAgentAvatar}
          onRemoveAgentAvatar={onRemoveAgentAvatar}
        />
      )}

      {agentDetailTab === "access" && (
        <AccessPanel
          agent={agent}
          tokens={tokens}
          tokensLoading={tokensLoading}
          tokensError={tokensError}
          tokenName={tokenName}
          expiresInDays={expiresInDays}
          issuingToken={issuingToken}
          issuedToken={issuedToken}
          revealedTokenId={revealedTokenId}
          copied={copied}
          onAgentUpdated={onAgentUpdated}
          onSuccess={onSuccess}
          onError={onError}
          onIssueToken={onIssueToken}
          onTokenNameChange={onTokenNameChange}
          onExpiresInDaysChange={onExpiresInDaysChange}
          onRequestRevealToken={onRequestRevealToken}
          onRevokeToken={onRevokeToken}
          onCopyToken={onCopyToken}
        />
      )}

      {agentDetailTab === "deliveries" && (
        <DeliveriesPanel agent={agent} onSuccess={onSuccess} onError={onError} />
      )}

      {agentDetailTab === "routing" && (
        <RoutingPanel agent={agent} onAgentUpdated={onAgentUpdated} onSuccess={onSuccess} onError={onError} />
      )}

      {agentDetailTab === "danger" && (
        <DangerPanel agentName={agent.name} onDeleteAgent={onDeleteAgent} />
      )}
    </div>
  );
}
