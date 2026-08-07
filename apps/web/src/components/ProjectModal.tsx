import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Project } from "@taskforge/contracts";

export function ProjectModal({ project, projects = [], onClose, onSave }: { project?: Project | null; projects?: Project[]; onClose: () => void; onSave: (project: { key: string; name: string; description: string; repoUrl: string | null; color: string }) => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState(project?.description ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [color, setColor] = useState(project?.color ?? "#6554C0");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
    try { await onSave({ name, key, description, repoUrl: repoUrl || null, color }); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : `Could not ${project ? "update" : "create"} project`); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="project-modal" onSubmit={submit}>
        <header><div><span className="modal-kicker">{project ? "Project settings" : "New workspace"}</span><h2>{project ? "Edit project" : "Create a project"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></header>
        <p>{project ? "Update the project details shown to your team." : "Use a short key to create readable task IDs, such as WEB-42."}</p>
        <div className="project-form-row"><label>Project name<input autoFocus value={name} onChange={(e) => { const nextName = e.target.value; setName(nextName); if (!keyEdited && !project) setKey(suggestedKey(nextName)); }} placeholder="Website launch" required /></label><label>Key<input value={key} onChange={(e) => { setKeyEdited(true); setKey(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase()); }} placeholder="WEB" minLength={2} maxLength={8} required disabled={Boolean(project)} />{!project && <small className="project-key-hint">Suggested keys are kept unique.</small>}</label></div>
        <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this project trying to achieve?" /></label>
        <label>Repository URL <span className="optional">Optional</span><input type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/your-org/repo" /></label>
        <label>Project color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        {error && <div className="form-error">{error}</div>}
        <footer><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? (project ? "Saving…" : "Creating…") : (project ? "Save changes" : "Create project")}</button></footer>
      </form>
    </div>
  );
}
