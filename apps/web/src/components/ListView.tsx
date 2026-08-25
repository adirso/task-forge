import { useEffect, useState } from "react";
import type { Phase, Project, Task } from "@taskforge/contracts";
import { CalendarDays, ChevronDown, ChevronRight, GitBranch, GitPullRequest } from "lucide-react";
import { formatDate, priorityMeta, statusMeta } from "../lib/ui";
import { Avatar } from "./Avatar";
import { TaskTagPills } from "./TaskTags";
import { TaskDependencyPills } from "./TaskDependencies";
import { TaskTypePill } from "./TaskTypePill";

const storageKey = (projectId: string) => `taskforge_list_collapsed_phases:${projectId}`;

export function ListView({ tasks, phases, project, onOpen }: { tasks: Task[]; phases: Phase[]; project: Project; onOpen: (task: Task) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey(project.id));
      const ids = raw ? JSON.parse(raw) as string[] : [];
      return new Set(Array.isArray(ids) ? ids : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(project.id));
      const ids = raw ? JSON.parse(raw) as string[] : [];
      setCollapsed(new Set(Array.isArray(ids) ? ids : []));
    } catch {
      setCollapsed(new Set());
    }
  }, [project.id]);

  useEffect(() => {
    localStorage.setItem(storageKey(project.id), JSON.stringify([...collapsed]));
  }, [collapsed, project.id]);

  const groups = [
    ...[...phases].sort((a, b) => b.number - a.number).map((phase) => ({ phase, tasks: tasks.filter((task) => task.phaseId === phase.id) })),
    ...(tasks.some((task) => !task.phaseId) ? [{ phase: null, tasks: tasks.filter((task) => !task.phaseId) }] : []),
  ];

  function toggle(groupId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="phase-list-stack">
      {groups.map((group) => {
        const groupId = group.phase?.id ?? "unassigned";
        const isCollapsed = collapsed.has(groupId);
        return (
          <section className={`phase-table-section${group.phase?.isActive ? " is-active" : ""}${isCollapsed ? " is-collapsed" : ""}`} key={groupId}>
            <button type="button" className="phase-table-header" aria-expanded={!isCollapsed} onClick={() => toggle(groupId)}>
              <span className="phase-collapse-icon" aria-hidden="true">{isCollapsed ? <ChevronRight /> : <ChevronDown />}</span>
              <span className="phase-list-number">{group.phase ? group.phase.number : "—"}</span>
              <div>
                <span>
                  <strong>{group.phase ? `Phase ${group.phase.number}` : "No phase"}</strong>
                  {group.phase?.isActive && <em>Active</em>}
                </span>
                <p>{group.phase?.goal ?? "Tasks that have not been planned into a phase."}</p>
              </div>
              <b>{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</b>
            </button>
            {!isCollapsed && (
              <div className="list-shell">
                <table className="task-table">
                  <thead><tr><th>Task</th><th>Type</th><th>Status</th><th>Assignee</th><th>Priority</th><th>Tags</th><th>Dependencies</th><th>Pull request</th><th>Due date</th><th>Points</th></tr></thead>
                  <tbody>{group.tasks.length ? group.tasks.map((task) => (
                    <tr key={task.id} onClick={() => onOpen(task)}>
                      <td><div className={`list-task-title ${task.parentId ? "is-subtask" : ""}`}>{task.parentId && <ChevronRight />}<span className="task-key">{project.key}-{task.number}</span><strong>{task.title}</strong>{task.branch && <GitBranch className="branch-icon" />}</div></td>
                      <td><TaskTypePill type={task.type} /></td>
                      <td><span className={`status-pill tone-${statusMeta[task.status].tone}`}><i />{statusMeta[task.status].label}</span></td>
                      <td>{task.assignee ? <span className="assignee-cell"><Avatar user={task.assignee} size="sm" /> {task.assignee.name}</span> : <span className="muted">Unassigned</span>}</td>
                      <td><span className={`priority priority-${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].symbol} {priorityMeta[task.priority].label}</span></td>
                      <td><TaskTagPills tags={task.tags} limit={3} />{!task.tags.length && <span className="muted">—</span>}</td>
                      <td><TaskDependencyPills dependencies={task.dependencies} limit={2} />{!task.dependencies.length && <span className="muted">—</span>}</td>
                      <td>{task.pullRequestUrl ? <a className={`list-pr pr-${task.pullRequestState?.toLowerCase() ?? "closed"}`} href={task.pullRequestUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} title={task.pullRequestTitle ?? task.pullRequestUrl}><GitPullRequest /> {task.pullRequestState ?? "PR"}</a> : <span className="muted">—</span>}</td>
                      <td>{task.dueDate ? <span className="date-cell"><CalendarDays /> {formatDate(task.dueDate)}</span> : <span className="muted">—</span>}</td>
                      <td>{task.estimatePoints ?? <span className="muted">—</span>}</td>
                    </tr>
                  )) : <tr className="empty-phase-row"><td colSpan={10}>No tasks match this phase and the current filters.</td></tr>}</tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
