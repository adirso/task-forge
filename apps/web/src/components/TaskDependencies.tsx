import type { Task, TaskDependency } from "@taskforge/contracts";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Link2, Search, X } from "lucide-react";
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
    <div className="dependency-search-row"><Search /><input aria-label="Search dependencies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${projectKey}-4 or task title…`} /></div>
    <div className="dependency-input-row"><Link2 /><select aria-label="Add dependency" value="" onChange={(event) => { if (event.target.value) { onChange([...value, event.target.value]); setQuery(""); } }}>
      <option value="">Select a task dependency…</option>
      {candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{projectKey}-{candidate.number} · {candidate.title} · {statusMeta[candidate.status].label}</option>)}
    </select></div>
    {query && !candidates.length && <span className="dependency-no-results">No tasks match “{query}”.</span>}
    <small className="dependency-help">Incomplete dependencies block this task.</small>
  </div>;
}
