import { useEffect, useState, type FormEvent } from "react";
import { TASK_TYPES, type AgentCapabilityProfile, type TaskType, type User } from "@taskforge/contracts";
import { Bot, Save } from "lucide-react";
import { api } from "../lib/api";
import { taskTypeMeta } from "../lib/ui";

const DEFAULT_PROFILE: AgentCapabilityProfile = { provider: "codex", model: "default", skills: [], taskTypes: [...TASK_TYPES], repositories: ["*"], maxConcurrency: 1, availability: "AVAILABLE", health: "UNKNOWN" };

export function AgentCapabilityEditor({ agent, onUpdated, onSuccess, onError }: { agent: User; onUpdated: (user: User) => void; onSuccess: (message: string) => void; onError: (message: string) => void }) {
  const [profile, setProfile] = useState(agent.capabilityProfile ?? DEFAULT_PROFILE);
  const [skills, setSkills] = useState((agent.capabilityProfile?.skills ?? []).join(", "));
  const [repositories, setRepositories] = useState((agent.capabilityProfile?.repositories ?? ["*"]).join("\n"));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setProfile(agent.capabilityProfile ?? DEFAULT_PROFILE); setSkills((agent.capabilityProfile?.skills ?? []).join(", ")); setRepositories((agent.capabilityProfile?.repositories ?? ["*"]).join("\n")); }, [agent]);
  function toggleTaskType(type: TaskType) { setProfile((current) => ({ ...current, taskTypes: current.taskTypes.includes(type) ? current.taskTypes.filter((value) => value !== type) : [...current.taskTypes, type] })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const { user } = await api.updateAgentCapabilities(agent.id, { ...profile, skills: skills.split(",").map((value) => value.trim()).filter(Boolean), repositories: repositories.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) });
      onUpdated(user); onSuccess("Capability profile saved");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save capability profile"); }
    finally { setSaving(false); }
  }
  return <form className="agent-capability-form" onSubmit={submit}>
    <div className="section-heading"><span><Bot /> Routing capabilities</span><small>Used for deterministic automatic assignment</small></div>
    {agent.capabilityProfileError && <div className="form-error">{agent.capabilityProfileError}</div>}
    <div className="pr-fields-row"><label>Provider<input value={profile.provider} onChange={(event) => setProfile({ ...profile, provider: event.target.value })} required /></label><label>Model<input value={profile.model} onChange={(event) => setProfile({ ...profile, model: event.target.value })} required /></label></div>
    <label>Skills<input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="typescript, security, ui" /><small>Comma-separated and matched case-insensitively.</small></label>
    <label>Repository access<textarea rows={2} value={repositories} onChange={(event) => setRepositories(event.target.value)} placeholder="github.com/org/repo or *" required /></label>
    <fieldset><legend>Supported task types</legend><div className="capability-task-types">{TASK_TYPES.map((type) => <label key={type}><input type="checkbox" checked={profile.taskTypes.includes(type)} onChange={() => toggleTaskType(type)} />{taskTypeMeta[type].label}</label>)}</div></fieldset>
    <div className="pr-fields-row"><label>Capacity<input type="number" min="1" max="32" value={profile.maxConcurrency} onChange={(event) => setProfile({ ...profile, maxConcurrency: Number(event.target.value) })} /></label><label>Availability<select value={profile.availability} onChange={(event) => setProfile({ ...profile, availability: event.target.value as AgentCapabilityProfile["availability"] })}><option value="AVAILABLE">Available</option><option value="PAUSED">Paused</option></select></label><label>Health<select value={profile.health} onChange={(event) => setProfile({ ...profile, health: event.target.value as AgentCapabilityProfile["health"] })}><option value="HEALTHY">Healthy</option><option value="DEGRADED">Degraded</option><option value="OFFLINE">Offline</option><option value="UNKNOWN">Unknown</option></select></label></div>
    <button className="button button-secondary" disabled={saving || profile.taskTypes.length === 0}><Save /> {saving ? "Saving…" : "Save capabilities"}</button>
  </form>;
}
