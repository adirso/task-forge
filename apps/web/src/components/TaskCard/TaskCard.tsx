import { CalendarDays, CheckSquare2, CircleAlert, GitBranch, GitPullRequest } from "lucide-react";
import { formatDate, priorityMeta } from "../../lib/ui";
import { Avatar } from "../Avatar";
import { TaskTagPills } from "../TaskTags";
import { TaskDependencyPills } from "../TaskDependencies";
import { TaskTypePill } from "../TaskTypePill";
import type { TaskCardProps } from "./types";
import styles from "./TaskCard.module.css";

export function TaskCard({ task, project, onOpen }: TaskCardProps) {
  return (
    <article
      className={styles.root}
      role="button"
      tabIndex={0}
      aria-label={`${project.key}-${task.number}: ${task.title}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.top}>
        <TaskTypePill type={task.type} />
        <span className={`priority priority-${task.priority.toLowerCase()}`}>
          {priorityMeta[task.priority].symbol} {priorityMeta[task.priority].label}
        </span>
        <span className="task-key">
          {project.key}-{task.number}
        </span>
      </div>
      <h3>{task.title}</h3>
      {task.tags.length > 0 && (
        <div className={styles.pills}>
          <TaskTagPills tags={task.tags} limit={3} />
        </div>
      )}
      {task.dependencies.length > 0 && (
        <div className={styles.pills}>
          <TaskDependencyPills dependencies={task.dependencies} limit={2} />
        </div>
      )}
      {task.blockedReason && (
        <span className={styles.blocked}>
          <CircleAlert />
          {task.blockedReason}
        </span>
      )}
      {task.parentId && (
        <span className={styles.subtask}>
          <CheckSquare2 /> Subtask
        </span>
      )}
      <div className={styles.meta}>
        <span>{task.estimatePoints !== null ? <><b>{task.estimatePoints}</b> pts</> : "No estimate"}</span>
        {task.branch && <span title={task.branch}><GitBranch /></span>}
        {task.pullRequestUrl && (task.pullRequestState === "OPEN" || task.pullRequestState === "DRAFT") && (
          <span
            className={`${styles.prIndicator} pr-${task.pullRequestState.toLowerCase()}`}
            title={`${task.pullRequestState === "DRAFT" ? "Draft" : "Open"} PR: ${task.pullRequestTitle ?? task.pullRequestUrl}`}
          >
            <GitPullRequest /> {task.pullRequestState === "DRAFT" ? "Draft" : "PR"}
          </span>
        )}
        {task.dueDate && (
          <span>
            <CalendarDays /> {formatDate(task.dueDate)}
          </span>
        )}
        <span className={styles.assignee}>
          {task.assignee ? <Avatar user={task.assignee} size="sm" /> : <span className="avatar avatar-sm avatar-empty">?</span>}
        </span>
      </div>
    </article>
  );
}
