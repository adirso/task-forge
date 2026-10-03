import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApiTokenMetadata, User } from "@taskforge/contracts";
import { Activity, Bot, Check, Copy, Download, Eye, HardDrive, KeyRound, LayoutDashboard, List, Monitor, Plus, Route, ShieldCheck, Trash2, Upload, UserRound, Webhook } from "lucide-react";
import { api } from "../lib/api";
import { type AgentDetailTab, type SettingsTab, parseSettingsTab, readSettingsLocation, writeSettingsLocation } from "../lib/settingsNav";
import { Avatar } from "./Avatar";
import { AgentOpsPage } from "./AgentOpsPage";
import { WebhookManager } from "./WebhookManager";
import { WebhookDeliveriesPanel } from "./WebhookDeliveriesPanel";
import { AgentCapabilityEditor } from "./AgentCapabilityEditor";
import { RevealTokenConfirmModal } from "./RevealTokenConfirmModal";

export function SettingsPage({ user, users, defaultView, textSize, onUserUpdated, onAgentCreated, onAgentUpdated, onAgentDeleted, onDefaultViewChange, onTextSizeChange }: {
  user: User;
  users: User[];
  defaultView: "board" | "list";
  textSize: "comfortable" | "large";
  onUserUpdated: (user: User) => void;
  onAgentCreated: (user: User) => void;
  onAgentUpdated: (user: User) => void;
  onAgentDeleted: (id: string) => void;
  onDefaultViewChange: (view: "board" | "list") => void;
  onTextSizeChange: (size: "comfortable" | "large") => void;
}) {
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

  async function revokeToken(id: string) {
    if (!window.confirm("Revoke this token? Any agent using it will immediately lose access.")) return;
    try {
      await api.revokeAgentToken(id);
      setTokens((items) => items.map((token) => token.id === id ? { ...token, revokedAt: new Date().toISOString(), revealable: false } : token));
      if (revealedTokenId === id) {
        setIssuedToken("");
        setRevealedTokenId("");
      }
      success("Token revoked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke token");
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

  return (
    <div className="settings-page">
      <header className="settings-header">
        <span>Workspace</span>
        <h1>Settings</h1>
        <p>Manage your account, workspace preferences, and agent access.</p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <button type="button" className={tab === "account" ? "active" : ""} aria-current={tab === "account" ? "page" : undefined} onClick={() => setTab("account")}><UserRound /> Account</button>
          <button type="button" className={tab === "appearance" ? "active" : ""} aria-current={tab === "appearance" ? "page" : undefined} onClick={() => setTab("appearance")}><Monitor /> Appearance</button>
          <button type="button" className={tab === "agents" ? "active" : ""} aria-current={tab === "agents" ? "page" : undefined} onClick={() => setTab("agents")}><Bot /> Agents <span>{agents.length}</span></button>
          {user.role === "ADMIN" && <button type="button" className={tab === "backup" ? "active" : ""} aria-current={tab === "backup" ? "page" : undefined} onClick={() => setTab("backup")}><HardDrive /> Backup</button>}
          {user.role === "ADMIN" && <button type="button" className={tab === "agentops" ? "active" : ""} aria-current={tab === "agentops" ? "page" : undefined} onClick={() => setTab("agentops")}><Activity /> Agent ops</button>}
        </nav>
        <section className="settings-content">
          {tab === "account" && (
            <div className="settings-section">
              <div className="settings-section-heading">
                <h2>Account details</h2>
                <p>These details identify you to project members and agents.</p>
              </div>
              <form className="profile-form" onSubmit={saveProfile}>
                <div className="profile-summary">
                  <Avatar user={user} size="lg" />
                  <span><strong>{user.name}</strong><small>{user.role.toLowerCase()} · human account</small></span>
                </div>
                <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
                <div><button type="submit" className="button button-primary">Save changes</button></div>
              </form>
            </div>
          )}

          {tab === "appearance" && (
            <div className="settings-section">
              <div className="settings-section-heading">
                <h2>Appearance</h2>
                <p>Choose how TaskForge looks when you return.</p>
              </div>
              <div className="preference-group">
                <h3>Default project view</h3>
                <div className="choice-grid">
                  <button type="button" className={defaultView === "board" ? "selected" : ""} onClick={() => onDefaultViewChange("board")}><LayoutDashboard /><span><strong>Board</strong><small>Visual workflow columns</small></span>{defaultView === "board" && <Check />}</button>
                  <button type="button" className={defaultView === "list" ? "selected" : ""} onClick={() => onDefaultViewChange("list")}><List /><span><strong>List</strong><small>Structured table view</small></span>{defaultView === "list" && <Check />}</button>
                </div>
              </div>
              <div className="preference-group">
                <h3>Text size</h3>
                <div className="choice-grid">
                  <button type="button" className={textSize === "comfortable" ? "selected" : ""} onClick={() => onTextSizeChange("comfortable")}><span className="text-preview text-preview-comfortable">Aa</span><span><strong>Comfortable</strong><small>Balanced information density</small></span>{textSize === "comfortable" && <Check />}</button>
                  <button type="button" className={textSize === "large" ? "selected" : ""} onClick={() => onTextSizeChange("large")}><span className="text-preview text-preview-large">Aa</span><span><strong>Large</strong><small>Extra readable text and controls</small></span>{textSize === "large" && <Check />}</button>
                </div>
              </div>
            </div>
          )}

          {tab === "agents" && (
            <div className="settings-section agents-settings-section">
              <div className="settings-section-heading agents-section-heading">
                <div>
                  <h2>Agents</h2>
                  <p>Create identities for automation and manage credentials, webhooks, and routing for each agent.</p>
                </div>
                {user.role === "ADMIN" && (
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-expanded={showNewAgentForm}
                    aria-controls="new-agent-form"
                    onClick={() => setShowNewAgentForm((open) => !open)}
                  >
                    <Plus /> {showNewAgentForm ? "Close" : "New agent"}
                  </button>
                )}
              </div>
              {user.role !== "ADMIN" ? (
                <div className="settings-notice">
                  <ShieldCheck />
                  <span><strong>Administrator access required</strong><small>Ask a workspace administrator to manage agent identities and tokens.</small></span>
                </div>
              ) : (
                <div className="agent-settings">
                  {showNewAgentForm && (
                    <form id="new-agent-form" className="new-agent-form" onSubmit={addAgent} aria-label="Create agent identity">
                      <h3><Plus /> New agent identity</h3>
                      <div>
                        <label>Name<input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Repository Builder" required autoComplete="off" /></label>
                        <label>Email <span>Optional</span><input type="email" value={agentEmail} onChange={(event) => setAgentEmail(event.target.value)} placeholder="builder@example.local" autoComplete="off" /></label>
                        <div className="new-agent-actions">
                          <button type="button" className="button button-secondary" disabled={creatingAgent} onClick={closeNewAgentForm}>Cancel</button>
                          <button type="submit" className="button button-primary" disabled={creatingAgent}>{creatingAgent ? "Creating…" : "Create agent"}</button>
                        </div>
                      </div>
                    </form>
                  )}

                  {!agents.length ? (
                    <div className="agent-empty-state" role="status">
                      <Bot />
                      <strong>No agents yet</strong>
                      <small>{showNewAgentForm ? "Fill in the form above to create your first agent identity." : "Use New agent to create an identity, then issue tokens and configure routing."}</small>
                      {!showNewAgentForm && (
                        <button type="button" className="button button-secondary" onClick={() => setShowNewAgentForm(true)}>
                          <Plus /> New agent
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="agent-manager">
                      <div className="agent-list" role="listbox" aria-label="Agents">
                        {agents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            role="option"
                            aria-selected={selectedAgentId === agent.id}
                            className={selectedAgentId === agent.id ? "active" : ""}
                            onClick={() => { setSelectedAgentId(agent.id); setAgentDetailTab("identity"); setIssuedToken(""); setRevealedTokenId(""); }}
                          >
                            <Avatar user={agent} size="md" />
                            <span><strong>{agent.name}</strong><small>{agent.email || "No email"}</small></span>
                          </button>
                        ))}
                      </div>

                      {selectedAgent ? (
                        <div className="agent-detail" aria-label={`${selectedAgent.name} settings`}>
                          <nav className="agent-detail-tabs" role="tablist" aria-label={`${selectedAgent.name} setting sections`}>
                            <button type="button" role="tab" aria-selected={agentDetailTab === "identity"} className={agentDetailTab === "identity" ? "active" : ""} onClick={() => setAgentDetailTab("identity")}><UserRound /> Identity</button>
                            <button type="button" role="tab" aria-selected={agentDetailTab === "access"} className={agentDetailTab === "access" ? "active" : ""} onClick={() => setAgentDetailTab("access")}><KeyRound /> Access</button>
                            <button type="button" role="tab" aria-selected={agentDetailTab === "deliveries"} className={agentDetailTab === "deliveries" ? "active" : ""} onClick={() => setAgentDetailTab("deliveries")}><Webhook /> Deliveries</button>
                            <button type="button" role="tab" aria-selected={agentDetailTab === "routing"} className={agentDetailTab === "routing" ? "active" : ""} onClick={() => setAgentDetailTab("routing")}><Route /> Routing</button>
                            <button type="button" role="tab" aria-selected={agentDetailTab === "danger"} className={agentDetailTab === "danger" ? "active" : ""} onClick={() => setAgentDetailTab("danger")}><Trash2 /> Danger zone</button>
                          </nav>

                          {agentDetailTab === "identity" && (
                            <section className="agent-panel" role="tabpanel" aria-label="Identity">
                              <header className="agent-panel-heading">
                                <h3>Identity</h3>
                                <p>Name and profile picture for this agent.</p>
                              </header>
                              <div className="agent-identity">
                                <Avatar user={selectedAgent} size="lg" />
                                <div className="agent-identity-copy">
                                  <strong>{selectedAgent.name}</strong>
                                  <small>{selectedAgent.email || "No email on file"}</small>
                                </div>
                                <div className="agent-avatar-actions">
                                  <label className="button button-secondary">
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg,image/gif,image/webp"
                                      aria-label="Change agent picture"
                                      onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void updateAgentAvatar(file);
                                        event.currentTarget.value = "";
                                      }}
                                    />
                                    {avatarUploading ? "Uploading…" : "Change picture"}
                                  </label>
                                  {selectedAgent.avatarUrl && (
                                    <button type="button" className="button button-secondary" disabled={avatarUploading} onClick={() => void removeAgentAvatar()}>
                                      Remove picture
                                    </button>
                                  )}
                                </div>
                              </div>
                            </section>
                          )}

                          {agentDetailTab === "access" && (
                            <section className="agent-panel" role="tabpanel" aria-label="Access">
                              <header className="agent-panel-heading">
                                <h3>Access</h3>
                                <p>Webhook endpoint and revocable API tokens. Secrets are shown only when created or revealed.</p>
                              </header>
                              <WebhookManager agent={selectedAgent} onAgentUpdated={onAgentUpdated} onSuccess={success} onError={setError} />
                              <div className="agent-token-block">
                                <h4>API tokens</h4>
                                <form className="token-form" onSubmit={issueToken} aria-label="Issue API token">
                                  <label>Token name<input value={tokenName} onChange={(event) => setTokenName(event.target.value)} required /></label>
                                  <label>Expires after
                                    <select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
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
                                      <button type="button" onClick={() => void copyToken()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>
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
                                            <button type="button" className="reveal-token" onClick={() => requestRevealToken(token)} title={`Reveal ${token.name}`} aria-label={`Reveal ${token.name}`}>
                                              <Eye />
                                            </button>
                                          )}
                                          {!token.revokedAt && (
                                            <button type="button" onClick={() => void revokeToken(token.id)} title="Revoke token" aria-label={`Revoke ${token.name}`}>
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
                            <section className="agent-panel agent-panel-deliveries" role="tabpanel" aria-label="Deliveries">
                              <header className="agent-panel-heading">
                                <h3>Deliveries</h3>
                                <p>Inspect and retry webhook delivery attempts for this agent.</p>
                              </header>
                              <WebhookDeliveriesPanel agent={selectedAgent} onSuccess={success} onError={setError} />
                            </section>
                          )}

                          {agentDetailTab === "routing" && (
                            <section className="agent-panel" role="tabpanel" aria-label="Routing">
                              <header className="agent-panel-heading">
                                <h3>Routing</h3>
                                <p>Capabilities used for deterministic automatic assignment.</p>
                              </header>
                              <AgentCapabilityEditor agent={selectedAgent} onUpdated={onAgentUpdated} onSuccess={success} onError={setError} embedded />
                            </section>
                          )}

                          {agentDetailTab === "danger" && (
                            <section className="agent-panel agent-panel-danger" role="tabpanel" aria-label="Danger zone">
                              <header className="agent-panel-heading">
                                <h3>Danger zone</h3>
                                <p>Deleting an agent revokes every token and removes the identity.</p>
                              </header>
                              <button type="button" className="button button-danger-quiet" onClick={() => deleteAgent().catch(() => undefined)}>
                                <Trash2 /> Delete {selectedAgent.name}
                              </button>
                            </section>
                          )}
                        </div>
                      ) : (
                        <div className="select-agent-empty" role="status">
                          <Bot />
                          <span>Select an agent to manage its settings.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "backup" && user.role === "ADMIN" && (
            <div className="settings-section backup-settings-section">
              <div className="settings-section-heading"><h2>Database backup</h2><p>Export a redacted transfer backup or restore a compatible secure archive. Redacted exports cannot be restored because they do not contain credentials; secrets are never shown in this interface.</p></div>
              <div className="backup-actions">
                <section className="backup-card"><Download /><div><h3>Export backup</h3><p>Download a gzip archive containing workspace data and attachments.</p></div><button type="button" className="button button-primary" onClick={() => void exportBackup()} disabled={backupBusy}><Download /> {backupBusy ? "Working…" : "Export and download"}</button></section>
                <section className="backup-card"><Upload /><div><h3>Restore backup</h3><p>Upload a validated archive to replace this workspace. Invalid or incompatible files leave the current database unchanged.</p></div><label className="button button-secondary"><Upload /> {backupBusy ? "Validating…" : "Choose backup file"}<input type="file" accept=".tar.gz,.tgz,application/gzip,application/x-gzip" onChange={(event) => void uploadBackup(event)} disabled={backupBusy} /></label></section>
              </div>
              {backupError && <div className="form-error backup-feedback" role="alert">{backupError}</div>}
              {backupMessage && <div className="form-success backup-feedback" role="status"><Check />{backupMessage}</div>}
            </div>
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

          {error && <div className="form-error settings-message" role="alert">{error}</div>}
          {message && <div className="form-success settings-message" role="status"><Check />{message}</div>}
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
    </div>
  );
}
