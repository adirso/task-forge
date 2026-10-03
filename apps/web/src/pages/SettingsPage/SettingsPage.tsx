import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApiTokenMetadata } from "@taskforge/contracts";
import { Activity, Bot, Check, HardDrive, Monitor, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../../lib/api";
import { type AgentDetailTab, type SettingsTab, parseSettingsTab, readSettingsLocation, writeSettingsLocation } from "../../lib/settingsNav";
import { AgentOpsPage } from "../AgentOpsPage";
import { RevealTokenConfirmModal } from "../../components/RevealTokenConfirmModal";
import { RevokeTokenConfirmModal } from "../../components/RevokeTokenConfirmModal";
import { AccountSection } from "./parts/AccountSection";
import { AppearanceSection } from "./parts/AppearanceSection";
import { AgentsSection } from "./parts/AgentsSection";
import { BackupSection } from "./parts/BackupSection";
import type { SettingsPageProps } from "./types";
import styles from "./SettingsPage.module.css";

export function SettingsPage({ user, users, defaultView, textSize, onUserUpdated, onAgentCreated, onAgentUpdated, onAgentDeleted, onDefaultViewChange, onTextSizeChange }: SettingsPageProps) {
  const initialSettings = useMemo(() => readSettingsLocation(window.location.search, user.role === "ADMIN"), [user.role]);
  const [tab, setTab] = useState<SettingsTab>(initialSettings.tab);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const agents = useMemo(() => users.filter((candidate) => candidate.kind === "AGENT"), [users]);
  const [selectedAgentId, setSelectedAgentId] = useState(initialSettings.agentId);
  const [agentDetailTab, setAgentDetailTab] = useState<AgentDetailTab>(initialSettings.agentTab);
  const [tokens, setTokens] = useState<ApiTokenMetadata[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState("");
  const [showNewAgentForm, setShowNewAgentForm] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [tokenName, setTokenName] = useState("Agent API token");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [issuingToken, setIssuingToken] = useState(false);
  const [issuedToken, setIssuedToken] = useState("");
  const [revealedTokenId, setRevealedTokenId] = useState("");
  const [tokenPendingReveal, setTokenPendingReveal] = useState<ApiTokenMetadata | null>(null);
  const [revealingToken, setRevealingToken] = useState(false);
  const [tokenPendingRevoke, setTokenPendingRevoke] = useState<ApiTokenMetadata | null>(null);
  const [revokingToken, setRevokingToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const prevAgentRef = useRef("");

  useEffect(() => {
    const nextTab = parseSettingsTab(tab, user.role === "ADMIN");
    if (nextTab !== tab) setTab(nextTab);
  }, [tab, user.role]);

  useEffect(() => {
    if (!agents.length) {
      if (selectedAgentId) setSelectedAgentId("");
      return;
    }
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return;
    const fromUrl = initialSettings.agentId && agents.some((agent) => agent.id === initialSettings.agentId) ? initialSettings.agentId : "";
    const nextId = fromUrl || agents[0]!.id;
    setSelectedAgentId(nextId);
    if (!fromUrl) setAgentDetailTab("identity");
  }, [agents, selectedAgentId, initialSettings.agentId]);

  useEffect(() => {
    const next = writeSettingsLocation({
      href: window.location.href,
      tab,
      agentId: selectedAgentId,
      agentTab: agentDetailTab,
    });
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [tab, selectedAgentId, agentDetailTab]);

  useEffect(() => {
    if (!selectedAgentId || user.role !== "ADMIN") {
      setTokens([]);
      setTokensLoading(false);
      setTokensError("");
      setRevealedTokenId("");
      setIssuedToken("");
      return;
    }
    if (prevAgentRef.current !== selectedAgentId) {
      setRevealedTokenId("");
      setIssuedToken("");
      setTokenPendingReveal(null);
      setTokenPendingRevoke(null);
      prevAgentRef.current = selectedAgentId;
    }
    let cancelled = false;
    setTokensLoading(true);
    setTokensError("");
    api.agentTokens(selectedAgentId)
      .then(({ tokens: result }) => { if (!cancelled) setTokens(result); })
      .catch((err) => {
        if (cancelled) return;
        setTokens([]);
        setTokensError(err instanceof Error ? err.message : "Could not load tokens");
      })
      .finally(() => { if (!cancelled) setTokensLoading(false); });
    return () => { cancelled = true; };
  }, [selectedAgentId, user.role, agents]);

  function success(text: string) {
    setMessage(text);
    setError("");
    window.setTimeout(() => setMessage(""), 2600);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { user: updated } = await api.updateProfile({ name, email });
      onUserUpdated(updated);
      success("Profile saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    }
  }

  function closeNewAgentForm() {
    setShowNewAgentForm(false);
    setAgentName("");
    setAgentEmail("");
  }

  async function addAgent(event: FormEvent) {
    event.preventDefault();
    setError("");
    setCreatingAgent(true);
    try {
      const { user: created } = await api.createAgent({ name: agentName, ...(agentEmail ? { email: agentEmail } : {}) });
      onAgentCreated(created);
      setSelectedAgentId(created.id);
      setAgentDetailTab("identity");
      closeNewAgentForm();
      success("Agent identity created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setCreatingAgent(false);
    }
  }

  async function issueToken(event: FormEvent) {
    event.preventDefault();
    if (!selectedAgentId) return;
    setError("");
    setIssuingToken(true);
    try {
      const result = await api.createAgentToken(selectedAgentId, { name: tokenName, expiresInDays: expiresInDays ? Number(expiresInDays) : null });
      setIssuedToken(result.token);
      setRevealedTokenId("");
      const metadata = await api.agentTokens(selectedAgentId);
      setTokens(metadata.tokens);
      success("Token issued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue token");
    } finally {
      setIssuingToken(false);
    }
  }

  function requestRevealToken(token: ApiTokenMetadata) {
    if (!selectedAgentId || token.revokedAt || !token.revealable) return;
    setTokenPendingReveal(token);
  }

  async function confirmRevealToken() {
    if (!selectedAgentId || !tokenPendingReveal) return;
    setError("");
    setRevealingToken(true);
    try {
      const result = await api.revealAgentToken(selectedAgentId, tokenPendingReveal.id);
      setIssuedToken(result.token);
      setRevealedTokenId(tokenPendingReveal.id);
      setTokenPendingReveal(null);
      success("Token revealed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reveal token");
    } finally {
      setRevealingToken(false);
    }
  }

  function requestRevokeToken(token: ApiTokenMetadata) {
    if (!selectedAgentId || token.revokedAt) return;
    setTokenPendingRevoke(token);
  }

  async function confirmRevokeToken() {
    if (!tokenPendingRevoke) return;
    const id = tokenPendingRevoke.id;
    setError("");
    setRevokingToken(true);
    try {
      await api.revokeAgentToken(id);
      setTokens((items) => items.map((token) => token.id === id ? { ...token, revokedAt: new Date().toISOString(), revealable: false } : token));
      if (revealedTokenId === id) {
        setIssuedToken("");
        setRevealedTokenId("");
      }
      setTokenPendingRevoke(null);
      success("Token revoked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke token");
    } finally {
      setRevokingToken(false);
    }
  }

  async function deleteAgent() {
    if (!selectedAgent || !window.confirm(`Delete ${selectedAgent.name}? This revokes all of the agent's tokens and removes its identity.`)) return;
    setError("");
    try {
      const deletedId = selectedAgent.id;
      await api.deleteAgent(deletedId);
      onAgentDeleted(deletedId);
      setSelectedAgentId(agents.find((agent) => agent.id !== deletedId)?.id ?? "");
      setTokens([]);
      setIssuedToken("");
      setRevealedTokenId("");
      success("Agent identity deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete agent");
    }
  }

  async function updateAgentAvatar(file: File) {
    if (!selectedAgent) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setError("Profile pictures must be images smaller than 2 MB");
      return;
    }
    setAvatarUploading(true);
    setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read profile picture"));
        reader.readAsDataURL(file);
      });
      const { user: updated } = await api.uploadUserAvatar(selectedAgent.id, { mimeType: file.type, data });
      onAgentUpdated(updated);
      success("Profile picture updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update profile picture");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function removeAgentAvatar() {
    if (!selectedAgent?.avatarUrl) return;
    setAvatarUploading(true);
    setError("");
    try {
      const { user: updated } = await api.deleteUserAvatar(selectedAgent.id);
      onAgentUpdated(updated);
      success("Profile picture removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove profile picture");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(issuedToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy token. Select and copy it manually.");
    }
  }

  async function exportBackup() {
    setBackupBusy(true); setBackupError(""); setBackupMessage("");
    try {
      const blob = await api.downloadBackup();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = href; link.download = "taskforge-backup.tar.gz"; link.click();
      URL.revokeObjectURL(href); setBackupMessage("Backup exported and downloaded");
    } catch (err) { setBackupError(err instanceof Error ? err.message : "Could not export backup"); }
    finally { setBackupBusy(false); }
  }

  async function uploadBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.currentTarget.value = "";
    if (!file) return;
    if (!window.confirm("Restore this secure backup and replace the current workspace? The current database will remain unchanged if validation fails.")) return;
    setBackupBusy(true); setBackupError(""); setBackupMessage("");
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read backup file")); reader.readAsDataURL(file); });
      await api.restoreBackup({ fileName: file.name, mimeType: file.type || "application/gzip", data });
      setBackupMessage("Backup restored successfully");
    } catch (err) { setBackupError(err instanceof Error ? err.message : "Could not restore backup"); }
    finally { setBackupBusy(false); }
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  function navClass(active: boolean) {
    return `${styles.navButton}${active ? ` ${styles.navButtonActive}` : ""}`;
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span>Workspace</span>
        <h1>Settings</h1>
        <p>Manage your account, workspace preferences, and agent access.</p>
      </header>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings sections">
          <button type="button" className={navClass(tab === "account")} aria-current={tab === "account" ? "page" : undefined} onClick={() => setTab("account")}><UserRound /> Account</button>
          <button type="button" className={navClass(tab === "appearance")} aria-current={tab === "appearance" ? "page" : undefined} onClick={() => setTab("appearance")}><Monitor /> Appearance</button>
          <button type="button" className={navClass(tab === "agents")} aria-current={tab === "agents" ? "page" : undefined} onClick={() => setTab("agents")}><Bot /> Agents <span>{agents.length}</span></button>
          {user.role === "ADMIN" && <button type="button" className={navClass(tab === "backup")} aria-current={tab === "backup" ? "page" : undefined} onClick={() => setTab("backup")}><HardDrive /> Backup</button>}
          {user.role === "ADMIN" && <button type="button" className={navClass(tab === "agentops")} aria-current={tab === "agentops" ? "page" : undefined} onClick={() => setTab("agentops")}><Activity /> Agent ops</button>}
        </nav>
        <section className={styles.content}>
          {tab === "account" && (
            <AccountSection
              user={user}
              name={name}
              email={email}
              onNameChange={setName}
              onEmailChange={setEmail}
              onSubmit={saveProfile}
            />
          )}

          {tab === "appearance" && (
            <AppearanceSection
              defaultView={defaultView}
              textSize={textSize}
              onDefaultViewChange={onDefaultViewChange}
              onTextSizeChange={onTextSizeChange}
            />
          )}

          {tab === "agents" && (
            <AgentsSection
              isAdmin={user.role === "ADMIN"}
              agents={agents}
              selectedAgentId={selectedAgentId}
              selectedAgent={selectedAgent}
              agentDetailTab={agentDetailTab}
              showNewAgentForm={showNewAgentForm}
              agentName={agentName}
              agentEmail={agentEmail}
              creatingAgent={creatingAgent}
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
              onToggleNewAgentForm={() => setShowNewAgentForm((open) => !open)}
              onOpenNewAgentForm={() => setShowNewAgentForm(true)}
              onCloseNewAgentForm={closeNewAgentForm}
              onAgentNameChange={setAgentName}
              onAgentEmailChange={setAgentEmail}
              onAddAgent={addAgent}
              onSelectAgent={(id) => {
                setSelectedAgentId(id);
                setAgentDetailTab("identity");
                setIssuedToken("");
                setRevealedTokenId("");
              }}
              onAgentDetailTabChange={setAgentDetailTab}
              onAgentUpdated={onAgentUpdated}
              onSuccess={success}
              onError={setError}
              onIssueToken={issueToken}
              onTokenNameChange={setTokenName}
              onExpiresInDaysChange={setExpiresInDays}
              onRequestRevealToken={requestRevealToken}
              onRequestRevokeToken={requestRevokeToken}
              onCopyToken={copyToken}
              onUpdateAgentAvatar={updateAgentAvatar}
              onRemoveAgentAvatar={removeAgentAvatar}
              onDeleteAgent={deleteAgent}
            />
          )}

          {tab === "backup" && user.role === "ADMIN" && (
            <BackupSection
              backupBusy={backupBusy}
              backupError={backupError}
              backupMessage={backupMessage}
              onExport={exportBackup}
              onUpload={uploadBackup}
            />
          )}

          {tab === "agentops" && (
            <div className="settings-section">
              <div className="settings-section-heading">
                <h2>Agent ops</h2>
                <p>Real-time fleet overview — workload, last activity, and stuck tasks for every agent.</p>
              </div>
              {user.role !== "ADMIN" ? (
                <div className="settings-notice">
                  <ShieldCheck />
                  <span><strong>Administrator access required</strong><small>Only admins can view the agent operations dashboard.</small></span>
                </div>
              ) : (
                <AgentOpsPage onOpenAgent={(id) => { setSelectedAgentId(id); setAgentDetailTab("identity"); setTab("agents"); }} />
              )}
            </div>
          )}

          {error && <div className={`form-error ${styles.message}`} role="alert">{error}</div>}
          {message && <div className={`form-success ${styles.message}`} role="status"><Check />{message}</div>}
        </section>
      </div>
      {tokenPendingReveal && (
        <RevealTokenConfirmModal
          token={tokenPendingReveal}
          busy={revealingToken}
          onClose={() => { if (!revealingToken) setTokenPendingReveal(null); }}
          onConfirm={() => void confirmRevealToken()}
        />
      )}
      {tokenPendingRevoke && (
        <RevokeTokenConfirmModal
          token={tokenPendingRevoke}
          busy={revokingToken}
          onClose={() => { if (!revokingToken) setTokenPendingRevoke(null); }}
          onConfirm={() => void confirmRevokeToken()}
        />
      )}
    </div>
  );
}
