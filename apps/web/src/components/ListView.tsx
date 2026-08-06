import type { Phase, Project, Task } from "@taskforge/contracts";
import { CalendarDays, ChevronRight, GitBranch, GitPullRequest } from "lucide-react";
import { formatDate, priorityMeta, statusMeta } from "../lib/ui";
import { Avatar } from "./Avatar";
import { TaskTagPills } from "./TaskTags";

export function ListView({ tasks, phases, project, onOpen }: { tasks: Task[]; phases: Phase[]; project: Project; onOpen: (task: Task) => void }) {
  const groups = [
    ...[...phases].sort((a, b) => b.number - a.number).map((phase) => ({ phase, tasks: tasks.filter((task) => task.phaseId === phase.id) })),
    ...(tasks.some((task) => !task.phaseId) ? [{ phase: null, tasks: tasks.filter((task) => !task.phaseId) }] : []),
  ];
  return (
    <div className="phase-list-stack">
      {groups.map((group) => <section className={`phase-table-section ${group.phase?.isActive ? "is-active" : ""}`} key={group.phase?.id ?? "unassigned"}>
        <header className="phase-table-header"><span className="phase-list-number">{group.phase ? group.phase.number : "—"}</span><div><span><strong>{group.phase ? `Phase ${group.phase.number}` : "No phase"}</strong>{group.phase?.isActive && <em>Active</em>}</span><p>{group.phase?.goal ?? "Tasks that have not been planned into a phase."}</p></div><b>{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</b></header>
        <div className="list-shell">
          <table className="task-table">
            <thead><tr><th>Task</th><th>Status</th><th>Assignee</th><th>Priority</th><th>Tags</th><th>Pull request</th><th>Due date</th><th>Points</th></tr></thead>
            <tbody>{group.tasks.length ? group.tasks.map((task) => (
              <tr key={task.id} onClick={() => onOpen(task)}>
                <td><div className={`list-task-title ${task.parentId ? "is-subtask" : ""}`}>{task.parentId && <ChevronRight />}<span className="task-key">{project.key}-{task.number}</span><strong>{task.title}</strong>{task.branch && <GitBranch className="branch-icon" />}</div></td>
                <td><span className={`status-pill tone-${statusMeta[task.status].tone}`}><i />{statusMeta[task.status].label}</span></td>
                <td>{task.assignee ? <span className="assignee-cell"><Avatar user={task.assignee} size="sm" /> {task.assignee.name}</span> : <span className="muted">Unassigned</span>}</td>
                <td><span className={`priority priority-${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].symbol} {priorityMeta[task.priority].label}</span></td>
                <td><TaskTagPills tags={task.tags} limit={3} />{!task.tags.length && <span className="muted">—</span>}</td>
                <td>{task.pullRequestUrl ? <a className={`list-pr pr-${task.pullRequestState?.toLowerCase() ?? "closed"}`} href={task.pullRequestUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} title={task.pullRequestTitle ?? task.pullRequestUrl}><GitPullRequest /> {task.pullRequestState ?? "PR"}</a> : <span className="muted">—</span>}</td>
                <td>{task.dueDate ? <span className="date-cell"><CalendarDays /> {formatDate(task.dueDate)}</span> : <span className="muted">—</span>}</td>
                <td>{task.estimatePoints ?? <span className="muted">—</span>}</td>
              </tr>
            )) : <tr className="empty-phase-row"><td colSpan={8}>No tasks match this phase and the current filters.</td></tr>}</tbody>
          </table>
        </div>
      </section>)}
    </div>
  );
}
