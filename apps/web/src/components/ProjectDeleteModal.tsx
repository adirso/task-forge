import { useState, type FormEvent } from "react";
import type { Project } from "@taskforge/contracts";
import { AlertTriangle, Trash2, X } from "lucide-react";

export function ProjectDeleteModal({ project, onClose, onConfirm }: { project: Project; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const matches = confirmation === project.key;

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!matches) return; setDeleting(true); setError("");
    try { await onConfirm(); } catch (err) { setError(err instanceof Error ? err.message : "Could not delete project"); setDeleting(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onClose(); }}>
      <form className="delete-project-modal" onSubmit={submit}>
        <header><span className="delete-warning-icon"><AlertTriangle /></span><button type="button" className="icon-button" onClick={onClose} disabled={deleting}><X /></button></header>
        <h2>Delete {project.name}?</h2>
        <p>This permanently deletes the project, its phases, tasks, updates, notifications, and activity history. This action cannot be undone.</p>
        <div className="delete-project-summary"><span className="project-glyph" style={{ background: project.color }}>{project.key.slice(0, 1)}</span><span><strong>{project.name}</strong><small>{project.key} · {project.taskCount ?? 0} tasks</small></span></div>
        <label>Type <strong>{project.key}</strong> to confirm<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={project.key} autoComplete="off" /></label>
        {error && <div className="form-error">{error}</div>}
        <footer><button type="button" className="button button-secondary" onClick={onClose} disabled={deleting}>Cancel</button><button className="button button-delete" disabled={!matches || deleting}><Trash2 /> {deleting ? "Deleting…" : "Delete project"}</button></footer>
      </form>
    </div>
  );
}
