import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { TASK_STATUSES, type Project, type TaskStatus } from "@taskforge/contracts";
import { statusMeta } from "../lib/ui";

type ProjectFormInput = { key: string; name: string; description: string; repoUrl: string | null; localRepoPath: string | null; color: string; availableStatuses?: TaskStatus[]; defaultStatus?: TaskStatus };

export function ProjectModal({ project, projects = [], onClose, onSave }: { project?: Project | null; projects?: Project[]; onClose: () => void; onSave: (project: ProjectFormInput) => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState(project?.description ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [localRepoPath, setLocalRepoPath] = useState(project?.localRepoPath ?? "");
  const [color, setColor] = useState(project?.color ?? "#6554C0");
  const [availableStatuses, setAvailableStatuses] = useState<TaskStatus[]>(project?.availableStatuses ?? [...TASK_STATUSES]);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>(project?.defaultStatus ?? "TODO");
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

  function toggleStatus(status: TaskStatus) {
    const checked = availableStatuses.includes(status);
    if (checked && availableStatuses.length === 1) return;
    const next = checked
      ? availableStatuses.filter((item) => item !== status)
      : TASK_STATUSES.filter((item) => item === status || availableStatuses.includes(item));
    setAvailableStatuses(next);
    if (!next.includes(defaultStatus)) setDefaultStatus(next[0]!);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        name,
        key,
        description,
        repoUrl: repoUrl || null,
        localRepoPath: localRepoPath.trim() || null,
        color,
        ...(project ? { availableStatuses, defaultStatus } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${project ? "update" : "create"} project`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className={`project-modal${project ? " is-editing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-modal-title"
        onSubmit={submit}
      >
        <header>
          <div className="modal-header-copy">
            <span className="modal-kicker">{project ? "Project settings" : "New workspace"}</span>
            <h2 id="project-modal-title">{project ? "Edit project" : "Create a project"}</h2>
            <p>{project ? "Update the details your team sees across board, list, and agents." : "Use a short key to create readable task IDs, such as WEB-42."}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        <div className="modal-body">
          <section className="project-form-section">
            <div className="project-form-section-head">
              <strong>Basics</strong>
              <span>Name, key, and how this project appears.</span>
            </div>
            <div className="project-form-row">
              <label>Project name
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setName(nextName);
                    if (!keyEdited && !project) setKey(suggestedKey(nextName));
                  }}
                  placeholder="Website launch"
                  required
                />
              </label>
              <label>Key
                <input
                  value={key}
                  onChange={(e) => {
                    setKeyEdited(true);
                    setKey(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
                  }}
                  placeholder="WEB"
                  minLength={2}
                  maxLength={8}
                  required
                  disabled={Boolean(project)}
                />
              </label>
            </div>
            <label>Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this project trying to achieve?" />
            </label>
            <label className="project-color-field">Project color
              <span className="project-color-control">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Project color" />
                <span style={{ background: color }} />
                <em>{color.toUpperCase()}</em>
              </span>
            </label>
          </section>

          <section className="project-form-section">
            <div className="project-form-section-head">
              <strong>Repository</strong>
              <span>Optional links used by agents and Smithy.</span>
            </div>
            <label>Repository URL <span className="optional">Optional</span>
              <input type="url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/your-org/repo" />
            </label>
            <label>Local Smithy repository path <span className="optional">Optional</span>
              <input value={localRepoPath} onChange={(e) => setLocalRepoPath(e.target.value)} placeholder="/Users/me/Development/task-forge" />
              <small>Used by the optional Smithy runner on the machine where it runs. This does not replace the repository URL.</small>
            </label>
          </section>

          {project && (
            <section className="project-form-section project-status-settings">
              <div className="project-form-section-head">
                <strong>Workflow</strong>
                <span>Choose which statuses appear on the board and list.</span>
              </div>
              <div className="project-status-options">
                {TASK_STATUSES.map((status) => {
                  const checked = availableStatuses.includes(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      className={checked ? "is-selected" : undefined}
                      aria-pressed={checked}
                      onClick={() => toggleStatus(status)}
                    >
                      <span className={`project-status-check${checked ? " on" : ""}`} aria-hidden>
                        {checked ? <Check strokeWidth={3} absoluteStrokeWidth /> : null}
                      </span>
                      <span className={`status-dot ${statusMeta[status].tone}`} />
                      <span>{statusMeta[status].label}</span>
                    </button>
                  );
                })}
              </div>
              <label>Default status for API-created tasks
                <select value={defaultStatus} onChange={(event) => setDefaultStatus(event.target.value as TaskStatus)}>
                  {availableStatuses.map((status) => (
                    <option key={status} value={status}>{statusMeta[status].label}</option>
                  ))}
                </select>
                <small>Used when an API request creates a task without a status.</small>
              </label>
            </section>
          )}

          {error && <div className="form-error">{error}</div>}
        </div>

        <footer>
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={saving}>
            {saving ? (project ? "Saving…" : "Creating…") : (project ? "Save changes" : "Create project")}
          </button>
        </footer>
      </form>
    </div>
  );
}
