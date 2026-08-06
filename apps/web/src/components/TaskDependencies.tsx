import type { Task, TaskDependency } from "@taskforge/contracts";
import { useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { statusMeta } from "../lib/ui";

export function TaskDependencyPills({ dependencies, limit }: { dependencies: TaskDependency[]; limit?: number }) {
  if (!dependencies.length) return null;
  const visible = limit ? dependencies.slice(0, limit) : dependencies;
  return <span className="task-dependency-list">
    {visible.map((dependency) => <span className={`task-dependency-pill ${dependency.isBlocking ? "is-blocking" : "is-resolved"}`} key={dependency.dependsOnTaskId} title={`${dependency.projectKey}-${dependency.number} · ${dependency.title} · ${statusMeta[dependency.status].label}`}>
      {dependency.isBlocking ? <CircleAlert /> : <CheckCircle2 />} {dependency.projectKey}-{dependency.number}
    </span>)}
    {limit && dependencies.length > limit && <span className="task-dependency-more">+{dependencies.length - limit}</span>}
  </span>;
}

export function TaskDependencyEditor({ value, tasks, projectKey, currentTaskId, onChange }: { value: string[]; tasks: Task[]; projectKey: string; currentTaskId?: string; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const candidates = tasks.filter((candidate) => {
    if (candidate.id === currentTaskId || value.includes(candidate.id)) return false;
    if (!normalizedQuery) return true;
    const taskKey = `${projectKey}-${candidate.number}`.toLowerCase();
    return taskKey.includes(normalizedQuery) || candidate.title.toLowerCase().includes(normalizedQuery);
  }).sort((a, b) => a.number - b.number);
  const selected = value.map((id) => tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));

  return <div className="task-dependency-editor">
    {selected.length > 0 && <div className="selected-task-dependencies">{selected.map((dependency) => <span className={`task-dependency-pill ${dependency.status === "DONE" ? "is-resolved" : "is-blocking"}`} key={dependency.id}>
      {dependency.status === "DONE" ? <CheckCircle2 /> : <CircleAlert />} {projectKey}-{dependency.number} · {dependency.title} · {statusMeta[dependency.status].label}
      <button type="button" aria-label={`Remove dependency ${dependency.title}`} onClick={() => onChange(value.filter((id) => id !== dependency.id))}><X /></button>
    </span>)}</div>}
    <div className="dependency-picker">
      <button type="button" className="dependency-select-trigger" aria-expanded={open} onClick={() => setOpen((isOpen) => !isOpen)}>
        {open ? "Search and select a dependency…" : "Select a task dependency…"}<span aria-hidden="true">⌄</span>
      </button>
      {open && <div className="dependency-menu">
        <input autoFocus aria-label="Search dependencies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${projectKey}-4 or task title…`} />
        <div className="dependency-options" role="listbox" aria-label="Available dependencies">
          {candidates.map((candidate) => <button type="button" role="option" className="dependency-option" key={candidate.id} onClick={() => { onChange([...value, candidate.id]); setQuery(""); setOpen(false); }}>
            <strong>{projectKey}-{candidate.number}</strong><span>{candidate.title}</span><em>{statusMeta[candidate.status].label}</em>
          </button>)}
          {query && !candidates.length && <span className="dependency-no-results">No tasks match “{query}”.</span>}
        </div>
      </div>}
    </div>
    <small className="dependency-help">Incomplete dependencies block this task.</small>
  </div>;
}
