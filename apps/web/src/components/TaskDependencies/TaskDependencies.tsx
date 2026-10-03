import { useState } from "react";
import type { DependencyResolutionStatus, Task } from "@taskforge/contracts";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { statusMeta } from "../../lib/ui";
import type { TaskDependencyEditorProps, TaskDependencyPillsProps } from "./types";
import styles from "./TaskDependencies.module.css";

export function TaskDependencyPills({ dependencies, limit }: TaskDependencyPillsProps) {
  if (!dependencies.length) return null;
  const visible = limit ? dependencies.slice(0, limit) : dependencies;
  return (
    <span className={styles.list}>
      {visible.map((dependency) => (
        <span
          className={`${styles.pill} ${dependency.isBlocking ? styles.blocking : styles.resolved}`}
          key={dependency.dependsOnTaskId}
          title={`${dependency.projectKey}-${dependency.number} · ${dependency.title} · ${statusMeta[dependency.status].label}`}
        >
          {dependency.isBlocking ? <CircleAlert /> : <CheckCircle2 />} {dependency.projectKey}-{dependency.number}
        </span>
      ))}
      {limit && dependencies.length > limit && <span className={styles.more}>+{dependencies.length - limit}</span>}
    </span>
  );
}

export function TaskDependencyEditor({
  value,
  tasks,
  projectKey,
  currentTaskId,
  resolutionStatuses,
  onChange,
}: TaskDependencyEditorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const candidates = tasks
    .filter((candidate) => {
      if (candidate.id === currentTaskId || value.includes(candidate.id)) return false;
      if (!normalizedQuery) return true;
      const taskKey = `${projectKey}-${candidate.number}`.toLowerCase();
      return taskKey.includes(normalizedQuery) || candidate.title.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => a.number - b.number);
  const selected = value.map((id) => tasks.find((task) => task.id === id)).filter((task): task is Task => Boolean(task));

  return (
    <div className={styles.editor}>
      {selected.length > 0 && (
        <div className={styles.selected}>
          {selected.map((dependency) => (
            <span
              className={`${styles.pill} ${resolutionStatuses.includes(dependency.status as DependencyResolutionStatus) ? styles.resolved : styles.blocking}`}
              key={dependency.id}
            >
              {resolutionStatuses.includes(dependency.status as DependencyResolutionStatus) ? <CheckCircle2 /> : <CircleAlert />}{" "}
              {projectKey}-{dependency.number} · {dependency.title} · {statusMeta[dependency.status].label}
              <button type="button" aria-label={`Remove dependency ${dependency.title}`} onClick={() => onChange(value.filter((id) => id !== dependency.id))}>
                <X />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.picker}>
        <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen((isOpen) => !isOpen)}>
          {open ? "Search and select a dependency…" : "Select a task dependency…"}
          <span aria-hidden="true">⌄</span>
        </button>
        {open && (
          <div className={styles.menu}>
            <input autoFocus aria-label="Search dependencies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${projectKey}-4 or task title…`} />
            <div className={styles.options} role="listbox" aria-label="Available dependencies">
              {candidates.map((candidate) => (
                <button
                  type="button"
                  role="option"
                  className={styles.option}
                  key={candidate.id}
                  onClick={() => {
                    onChange([...value, candidate.id]);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <strong>
                    {projectKey}-{candidate.number}
                  </strong>
                  <span>{candidate.title}</span>
                  <em>{statusMeta[candidate.status].label}</em>
                </button>
              ))}
              {query && !candidates.length && <span className={styles.noResults}>No tasks match “{query}”.</span>}
            </div>
          </div>
        )}
      </div>
      <small className={styles.help}>
        Incomplete dependencies block agent claiming and start transitions. DONE always resolves a dependency
        {resolutionStatuses.includes("CANCELLED") ? "; CANCELLED also resolves it for this project" : "; CANCELLED remains blocking for this project"}.
      </small>
    </div>
  );
}
