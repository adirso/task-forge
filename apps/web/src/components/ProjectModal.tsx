import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { DEFAULT_AGENT_WORKFLOW, TASK_STATUSES, type AgentWorkflow, type Project, type TaskStatus } from "@taskforge/contracts";
import { statusMeta } from "../lib/ui";

type ProjectFormInput = { key: string; name: string; description: string; repoUrl: string | null; localRepoPath: string | null; color: string; availableStatuses?: TaskStatus[]; defaultStatus?: TaskStatus; agentWorkflow?: AgentWorkflow | null };

export function ProjectModal({ project, projects = [], onClose, onSave, onEnableWorkflow }: { project?: Project | null; projects?: Project[]; onClose: () => void; onSave: (project: ProjectFormInput) => Promise<void>; onEnableWorkflow?: () => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState(project?.description ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [localRepoPath, setLocalRepoPath] = useState(project?.localRepoPath ?? "");
  const [color, setColor] = useState(project?.color ?? "#6554C0");
  const [availableStatuses, setAvailableStatuses] = useState<TaskStatus[]>(project?.availableStatuses ?? [...TASK_STATUSES]);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>(project?.defaultStatus ?? "TODO");
  const [agentWorkflow, setAgentWorkflow] = useState<AgentWorkflow | null>(project?.agentWorkflow ?? null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [enabling, setEnabling] = useState(false);
  function suggestedKey(value: string) {
    const base = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "NEW";
    const used = new Set(projects.map((item) => item.key.toUpperCase()));
    if (!used.has(base)) return base;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base.slice(0, Math.max(1, 8 - String(suffix).length))}${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base.slice(0, 7)}9`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave({ name, key, description, repoUrl: repoUrl || null, localRepoPath: localRepoPath.trim() || null, color, ...(project ? { availableStatuses, defaultStatus, agentWorkflow } : {}) }); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : `Could not ${project ? "update" : "create"} project`); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="project-modal" onSubmit={submit}>
        <header><div><span className="modal-kicker">{project ? "Project settings" : "New workspace"}</span><h2>{project ? "Edit project" : "Create a project"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
        <p>{project ? "Update the project details shown to your team." : "Use a short key to create readable task IDs, such as WEB-42."}</p>
        <div className="project-form-row"><label>Project name<input autoFocus value={name} onChange={(e) => { const nextName = e.target.value; setName(nextName); if (!keyEdited && !project) setKey(suggestedKey(nextName)); }} placeholder="Website launch" required /></label><label>Key<input value={key} onChange={(e) => { setKeyEdited(true); setKey(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()); }} placeholder="WEB" minLength={2} maxLength={8} required disabled={Boolean(project)} /></label></div>
        <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this project trying to achieve?" /></label>
        <label>Repository URL <span className="optional">Optional</span><input type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/your-org/repo" /></label>
        <label>Local Smithy repository path <span className="optional">Optional</span><input value={localRepoPath} onChange={(e) => setLocalRepoPath(e.target.value)} placeholder="/Users/me/Development/task-forge" /><small>Used by the optional Smithy runner on the machine where it runs. This does not replace the repository URL.</small></label>
        <label>Project color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        {project && <section className="project-status-settings">
          <div><strong>Task statuses</strong><span>Choose the statuses available on this project.</span></div>
          <div className="project-status-options">{TASK_STATUSES.map((status) => {
            const checked = availableStatuses.includes(status);
            return <label key={status} className={checked ? "is-selected" : ""}><input type="checkbox" checked={checked} onChange={() => {
              if (checked && availableStatuses.length === 1) return;
              const next = checked ? availableStatuses.filter((item) => item !== status) : TASK_STATUSES.filter((item) => item === status || availableStatuses.includes(item));
              setAvailableStatuses(next);
              if (!next.includes(defaultStatus)) setDefaultStatus(next[0]!);
            }} /><span className={`status-dot ${statusMeta[status].tone}`} />{statusMeta[status].label}</label>;
          })}</div>
          <label>Default status for API-created tasks<select value={defaultStatus} onChange={(event) => setDefaultStatus(event.target.value as TaskStatus)}>{availableStatuses.map((status) => <option key={status} value={status}>{statusMeta[status].label}</option>)}</select><small>Used when an API request creates a task without a status.</small></label>
        </section>}
        {project && <section className="project-status-settings">
          <div><strong>Agent workflow</strong><span>Configure the statuses Smithy uses for implementation and review handoffs.</span></div>
          {!agentWorkflow ? <button type="button" className="button button-secondary" disabled={enabling} onClick={async () => {
            if (!onEnableWorkflow) { setAvailableStatuses([...TASK_STATUSES]); setDefaultStatus("TODO"); setAgentWorkflow({ ...DEFAULT_AGENT_WORKFLOW }); return; }
            setEnabling(true);
            try { await onEnableWorkflow(); onClose(); } finally { setEnabling(false); }
          }}>{enabling ? "Enabling…" : "Enable default agent workflow"}</button> : <div className="project-status-options">
            {(Object.keys(DEFAULT_AGENT_WORKFLOW) as Array<keyof AgentWorkflow>).map((role) => <label key={role}>{role.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())}<select value={agentWorkflow[role]} onChange={(event) => setAgentWorkflow({ ...agentWorkflow, [role]: event.target.value as TaskStatus })}>{availableStatuses.map((status) => <option key={status} value={status}>{statusMeta[status].label}</option>)}</select></label>)}
          </div>}
        </section>}
        {error && <div className="form-error">{error}</div>}
        <footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? (project ? "Saving…" : "Creating…") : (project ? "Save changes" : "Create project")}</button></footer>
      </form>
    </div>
  );
}
