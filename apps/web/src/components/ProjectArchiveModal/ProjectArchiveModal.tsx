import { useState } from "react";
import { Archive, ArchiveRestore, X } from "lucide-react";

import type { ProjectArchiveModalProps } from "./types";
import styles from "./ProjectArchiveModal.module.css";

export function ProjectArchiveModal({ project, onClose, onConfirm }: ProjectArchiveModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const restoring = Boolean(project.archivedAt);

  async function confirm() {
    setSaving(true); setError("");
    try { await onConfirm(); } catch (err) { setError(err instanceof Error ? err.message : `Could not ${restoring ? "restore" : "archive"} project`); setSaving(false); }
  }

  return (
    <div className={`modal-backdrop ${styles.root}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="archive-project-modal" role="dialog" aria-modal="true" aria-labelledby="archive-project-title">
        <header><span className="archive-project-icon">{restoring ? <ArchiveRestore /> : <Archive />}</span><button type="button" className="icon-button" onClick={onClose} disabled={saving} aria-label="Close archive confirmation"><X /></button></header>
        <h2 id="archive-project-title">{restoring ? `Restore ${project.name}?` : `Archive ${project.name}?`}</h2>
        <p>{restoring
          ? "The project returns to the active project list and dashboard."
          : "The project is hidden from the active project list and dashboard. Its tasks, phases, and history are kept unchanged, and you can restore it from the archived projects view."}</p>
        <div className="archive-project-summary"><span className="project-glyph" style={{ background: project.color }}>{project.key.slice(0, 1)}</span><span><strong>{project.name}</strong><small>{project.key} · {project.taskCount ?? 0} tasks</small></span></div>
        {error && <div className="form-error">{error}</div>}
        <footer>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => { void confirm(); }} disabled={saving}>{restoring ? <ArchiveRestore /> : <Archive />} {saving ? (restoring ? "Restoring…" : "Archiving…") : (restoring ? "Restore project" : "Archive project")}</button>
        </footer>
      </section>
    </div>
  );
}
