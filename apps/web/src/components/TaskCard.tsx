import type { Project, Task } from "@taskforge/contracts";
import { CalendarDays, CheckSquare2, GitBranch, GitPullRequest } from "lucide-react";
import { formatDate, priorityMeta } from "../lib/ui";
import { Avatar } from "./Avatar";
import { TaskTagPills } from "./TaskTags";

export function TaskCard({ task, project, onOpen }: { task: Task; project: Project; onOpen: () => void }) {
  return (
    <article className="task-card" draggable onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)} onClick={onOpen}>
      <div className="card-top"><span className={`priority priority-${task.priority.toLowerCase()}`}>{priorityMeta[task.priority].symbol} {priorityMeta[task.priority].label}</span><span className="task-key">{project.key}-{task.number}</span></div>
      <h3>{task.title}</h3>
      <TaskTagPills tags={task.tags} limit={3} />
      {task.parentId && <span className="subtask-label"><CheckSquare2 /> Subtask</span>}
      <div className="card-meta">
        <span>{task.estimatePoints !== null ? <><b>{task.estimatePoints}</b> pts</> : "No estimate"}</span>
        {task.branch && <span title={task.branch}><GitBranch /></span>}
        {task.pullRequestUrl && (task.pullRequestState === "OPEN" || task.pullRequestState === "DRAFT") && <span className={`pr-indicator pr-${task.pullRequestState.toLowerCase()}`} title={`${task.pullRequestState === "DRAFT" ? "Draft" : "Open"} PR: ${task.pullRequestTitle ?? task.pullRequestUrl}`}><GitPullRequest /> {task.pullRequestState === "DRAFT" ? "Draft" : "PR"}</span>}
        {task.dueDate && <span><CalendarDays /> {formatDate(task.dueDate)}</span>}
        <span className="card-assignee">{task.assignee ? <Avatar user={task.assignee} size="sm" /> : <span className="avatar avatar-sm avatar-empty">?</span>}</span>
      </div>
    </article>
  );
}
