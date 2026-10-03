import { Bot, Plus, ShieldCheck } from "lucide-react";
import { NewAgentForm } from "./parts/NewAgentForm";
import { AgentPicker } from "./parts/AgentPicker";
import { AgentDetail } from "./parts/AgentDetail";
import type { AgentsSectionProps } from "./types";
import styles from "./AgentsSection.module.css";

export function AgentsSection({
  isAdmin,
  agents,
  selectedAgentId,
  selectedAgent,
  agentDetailTab,
  showNewAgentForm,
  agentName,
  agentEmail,
  creatingAgent,
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
  onToggleNewAgentForm,
  onOpenNewAgentForm,
  onCloseNewAgentForm,
  onAgentNameChange,
  onAgentEmailChange,
  onAddAgent,
  onSelectAgent,
  onAgentDetailTabChange,
  onAgentUpdated,
  onSuccess,
  onError,
  onIssueToken,
  onTokenNameChange,
  onExpiresInDaysChange,
  onRequestRevealToken,
  onRequestRevokeToken,
  onCopyToken,
  onUpdateAgentAvatar,
  onRemoveAgentAvatar,
  onDeleteAgent,
}: AgentsSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <div>
          <h2>Agents</h2>
          <p>Create identities for automation and manage credentials, webhooks, and routing for each agent.</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="button button-secondary"
            aria-expanded={showNewAgentForm}
            aria-controls="new-agent-form"
            onClick={onToggleNewAgentForm}
          >
            <Plus /> {showNewAgentForm ? "Close" : "New agent"}
          </button>
        )}
      </div>
      {!isAdmin ? (
        <div className={styles.notice}>
          <ShieldCheck />
          <span><strong>Administrator access required</strong><small>Ask a workspace administrator to manage agent identities and tokens.</small></span>
        </div>
      ) : (
        <div className={styles.settings}>
          {showNewAgentForm && (
            <NewAgentForm
              agentName={agentName}
              agentEmail={agentEmail}
              creatingAgent={creatingAgent}
              onAgentNameChange={onAgentNameChange}
              onAgentEmailChange={onAgentEmailChange}
              onSubmit={onAddAgent}
              onCancel={onCloseNewAgentForm}
            />
          )}

          {!agents.length ? (
            <div className={styles.empty} role="status">
              <Bot />
              <strong>No agents yet</strong>
              <small>{showNewAgentForm ? "Fill in the form above to create your first agent identity." : "Use New agent to create an identity, then issue tokens and configure routing."}</small>
              {!showNewAgentForm && (
                <button type="button" className="button button-secondary" onClick={onOpenNewAgentForm}>
                  <Plus /> New agent
                </button>
              )}
            </div>
          ) : (
            <div className={styles.manager}>
              <AgentPicker
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
              />

              {selectedAgent ? (
                <AgentDetail
                  agent={selectedAgent}
                  agentDetailTab={agentDetailTab}
                  tokens={tokens}
                  tokensLoading={tokensLoading}
                  tokensError={tokensError}
                  tokenName={tokenName}
                  expiresInDays={expiresInDays}
                  issuingToken={issuingToken}
                  issuedToken={issuedToken}
                  revealedTokenId={revealedTokenId}
                  copied={copied}
                  avatarUploading={avatarUploading}
                  onAgentDetailTabChange={onAgentDetailTabChange}
                  onAgentUpdated={onAgentUpdated}
                  onSuccess={onSuccess}
                  onError={onError}
                  onIssueToken={onIssueToken}
                  onTokenNameChange={onTokenNameChange}
                  onExpiresInDaysChange={onExpiresInDaysChange}
                  onRequestRevealToken={onRequestRevealToken}
                  onRequestRevokeToken={onRequestRevokeToken}
                  onCopyToken={onCopyToken}
                  onUpdateAgentAvatar={onUpdateAgentAvatar}
                  onRemoveAgentAvatar={onRemoveAgentAvatar}
                  onDeleteAgent={onDeleteAgent}
                />
              ) : (
                <div className={styles.selectEmpty} role="status">
                  <Bot />
                  <span>Select an agent to manage its settings.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
