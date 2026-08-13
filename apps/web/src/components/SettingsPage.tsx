import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ApiTokenMetadata, User } from "@taskforge/contracts";
import { Bot, Check, Copy, Eye, KeyRound, LayoutDashboard, List, Monitor, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";

type SettingsTab = "account" | "appearance" | "agents";

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
  const [tab, setTab] = useState<SettingsTab>("account");
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const agents = useMemo(() => users.filter((candidate) => candidate.kind === "AGENT"), [users]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [tokens, setTokens] = useState<ApiTokenMetadata[]>([]);
  const [agentName, setAgentName] = useState("");
  const [agentEmail, setAgentEmail] = useState("");
  const [tokenName, setTokenName] = useState("Agent API token");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [issuedToken, setIssuedToken] = useState("");
  const [revealedTokenId, setRevealedTokenId] = useState("");
  const [copied, setCopied] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (!selectedAgentId && agents[0]) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId || user.role !== "ADMIN") { setTokens([]); setRevealedTokenId(""); setIssuedToken(""); return; }
    setRevealedTokenId(""); setIssuedToken("");
    api.agentTokens(selectedAgentId).then(({ tokens: result }) => setTokens(result)).catch(() => setTokens([]));
  }, [selectedAgentId, user.role]);

  function success(text: string) { setMessage(text); setError(""); window.setTimeout(() => setMessage(""), 2600); }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setError("");
    try { const { user: updated } = await api.updateProfile({ name, email }); onUserUpdated(updated); success("Profile saved"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save profile"); }
  }

  async function addAgent(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const { user: created } = await api.createAgent({ name: agentName, ...(agentEmail ? { email: agentEmail } : {}) });
      onAgentCreated(created); setSelectedAgentId(created.id); setAgentName(""); setAgentEmail(""); success("Agent identity created");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create agent"); }
  }

  async function issueToken(event: FormEvent) {
    event.preventDefault(); if (!selectedAgentId) return; setError("");
    try {
      const result = await api.createAgentToken(selectedAgentId, { name: tokenName, expiresInDays: expiresInDays ? Number(expiresInDays) : null });
      setIssuedToken(result.token); setRevealedTokenId(""); const metadata = await api.agentTokens(selectedAgentId); setTokens(metadata.tokens); success("Token issued");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not issue token"); }
  }

  async function revealToken(token: ApiTokenMetadata) {
    if (!selectedAgentId || token.revokedAt || !token.revealable) return;
    if (!window.confirm(`Reveal the full token for “${token.name}”? Anyone with this value can act as the agent.`)) return;
    setError("");
    try {
      const result = await api.revealAgentToken(selectedAgentId, token.id);
      setIssuedToken(result.token);
      setRevealedTokenId(token.id);
      success("Token revealed");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not reveal token"); }
  }

  async function revokeToken(id: string) {
    if (!window.confirm("Revoke this token? Any agent using it will immediately lose access.")) return;
    try {
      await api.revokeAgentToken(id);
      setTokens((items) => items.map((token) => token.id === id ? { ...token, revokedAt: new Date().toISOString(), revealable: false } : token));
      if (revealedTokenId === id) { setIssuedToken(""); setRevealedTokenId(""); }
      success("Token revoked");
    }
    catch (err) { setError(err instanceof Error ? err.message : "Could not revoke token"); }
  }

  async function deleteAgent() {
    if (!selectedAgent || !window.confirm(`Delete ${selectedAgent.name}? This revokes all of the agent's tokens and removes its identity.`)) return;
    setError("");
    try {
      const deletedId = selectedAgent.id;
      await api.deleteAgent(deletedId);
      onAgentDeleted(deletedId);
      setSelectedAgentId(agents.find((agent) => agent.id !== deletedId)?.id ?? "");
      setTokens([]); setIssuedToken(""); setRevealedTokenId("");
      success("Agent identity deleted");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete agent"); }
  }

  async function updateAgentAvatar(file: File) {
    if (!selectedAgent) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) { setError("Profile pictures must be images smaller than 2 MB"); return; }
    setAvatarUploading(true); setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read profile picture")); reader.readAsDataURL(file); });
      const { user: updated } = await api.uploadUserAvatar(selectedAgent.id, { mimeType: file.type, data }); onAgentUpdated(updated); success("Profile picture updated");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update profile picture"); }
    finally { setAvatarUploading(false); }
  }

  async function removeAgentAvatar() {
    if (!selectedAgent?.avatarUrl) return;
    setAvatarUploading(true); setError("");
    try { const { user: updated } = await api.deleteUserAvatar(selectedAgent.id); onAgentUpdated(updated); success("Profile picture removed"); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove profile picture"); }
    finally { setAvatarUploading(false); }
  }

  async function copyToken() {
    await navigator.clipboard.writeText(issuedToken); setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);

  return (
    <div className="settings-page">
      <header className="settings-header"><span>Workspace</span><h1>Settings</h1><p>Manage your account, workspace preferences, and agent access.</p></header>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}><UserRound /> Account</button>
          <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}><Monitor /> Appearance</button>
          <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}><Bot /> Agents <span>{agents.length}</span></button>
        </nav>
        <section className="settings-content">
          {tab === "account" && <div className="settings-section"><div className="settings-section-heading"><h2>Account details</h2><p>These details identify you to project members and agents.</p></div><form className="profile-form" onSubmit={saveProfile}><div className="profile-summary"><Avatar user={user} size="lg" /><span><strong>{user.name}</strong><small>{user.role.toLowerCase()} · human account</small></span></div><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><div><button className="button button-primary">Save changes</button></div></form></div>}

          {tab === "appearance" && <div className="settings-section"><div className="settings-section-heading"><h2>Appearance</h2><p>Choose how TaskForge looks when you return.</p></div><div className="preference-group"><h3>Default project view</h3><div className="choice-grid"><button className={defaultView === "board" ? "selected" : ""} onClick={() => onDefaultViewChange("board")}><LayoutDashboard /><span><strong>Board</strong><small>Visual workflow columns</small></span>{defaultView === "board" && <Check />}</button><button className={defaultView === "list" ? "selected" : ""} onClick={() => onDefaultViewChange("list")}><List /><span><strong>List</strong><small>Structured table view</small></span>{defaultView === "list" && <Check />}</button></div></div><div className="preference-group"><h3>Text size</h3><div className="choice-grid"><button className={textSize === "comfortable" ? "selected" : ""} onClick={() => onTextSizeChange("comfortable")}><span className="text-preview text-preview-comfortable">Aa</span><span><strong>Comfortable</strong><small>Balanced information density</small></span>{textSize === "comfortable" && <Check />}</button><button className={textSize === "large" ? "selected" : ""} onClick={() => onTextSizeChange("large")}><span className="text-preview text-preview-large">Aa</span><span><strong>Large</strong><small>Extra readable text and controls</small></span>{textSize === "large" && <Check />}</button></div></div></div>}

          {tab === "agents" && <div className="settings-section"><div className="settings-section-heading"><h2>Agents & API tokens</h2><p>Create identities for automation and manage their revocable credentials.</p></div>{user.role !== "ADMIN" ? <div className="settings-notice"><ShieldCheck /><span><strong>Administrator access required</strong><small>Ask a workspace administrator to manage agent identities and tokens.</small></span></div> : <div className="agent-settings"><form className="new-agent-form" onSubmit={addAgent}><h3><Plus /> New agent identity</h3><div><label>Name<input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Repository Builder" required /></label><label>Email <span>Optional</span><input type="email" value={agentEmail} onChange={(event) => setAgentEmail(event.target.value)} placeholder="builder@example.local" /></label><button className="button button-secondary">Create agent</button></div></form><div className="agent-manager"><div className="agent-list">{agents.map((agent) => <button key={agent.id} className={selectedAgentId === agent.id ? "active" : ""} onClick={() => { setSelectedAgentId(agent.id); setIssuedToken(""); setRevealedTokenId(""); }}><Avatar user={agent} size="md" /><span><strong>{agent.name}</strong><small>{agent.email}</small></span></button>)}</div>{selectedAgent ? <div className="token-manager"><div className="token-manager-title"><Avatar user={selectedAgent} /><span><strong>{selectedAgent.name}</strong><small>Token credentials</small></span></div><form className="token-form" onSubmit={issueToken}><label>Token name<input value={tokenName} onChange={(event) => setTokenName(event.target.value)} required /></label><label>Expires after<select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option><option value="">Never</option></select></label><button className="button button-primary"><KeyRound /> Issue token</button></form>{issuedToken && <div className="issued-token"><strong>{revealedTokenId ? "Revealed token" : "Copy this token now"}</strong><p>{revealedTokenId ? "Store it securely. You can reveal it again from the list below." : "You can also reveal it later from the issued tokens list."}</p><div><code>{issuedToken}</code><button type="button" onClick={copyToken}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button></div></div>}<div className="token-list"><h3>Issued tokens</h3>{tokens.length ? tokens.map((token) => <article key={token.id} className={token.revokedAt ? "revoked" : ""}><KeyRound /><span><strong>{token.name}</strong><small>tf_{token.prefix}_… · {token.revokedAt ? "Revoked" : token.lastUsedAt ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}{!token.revokedAt && !token.revealable ? " · Not recoverable" : ""}</small></span><div className="token-actions">{!token.revokedAt && token.revealable && <button type="button" className="reveal-token" onClick={() => void revealToken(token)} title={`Reveal ${token.name}`}><Eye /></button>}{!token.revokedAt && <button type="button" onClick={() => void revokeToken(token.id)} title="Revoke token"><Trash2 /></button>}</div></article>) : <p className="no-tokens">No tokens issued for this agent.</p>}</div></div> : <div className="select-agent-empty"><Bot /><span>Create or select an agent to manage its tokens.</span></div>}</div></div>}</div>}
          {error && <div className="form-error settings-message">{error}</div>}{message && <div className="form-success settings-message"><Check />{message}</div>}
          {tab === "agents" && user.role === "ADMIN" && selectedAgent && <div className="agent-delete-action"><div className="agent-avatar-actions"><label className="button button-secondary"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void updateAgentAvatar(file); event.currentTarget.value = ""; }} />{avatarUploading ? "Uploading…" : "Change picture"}</label>{selectedAgent.avatarUrl && <button type="button" className="button button-secondary" disabled={avatarUploading} onClick={() => void removeAgentAvatar()}>Remove picture</button>}</div><button type="button" className="button button-danger-quiet" onClick={() => deleteAgent().catch(() => undefined)}><Trash2 /> Delete selected agent</button></div>}
        </section>
      </div>
    </div>
  );
}
