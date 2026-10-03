import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import { statusMeta } from "../../../../lib/ui";
import { TaskCard } from "../../../../components/TaskCard";
import type { BoardColumnsProps } from "./types";
import styles from "./BoardColumns.module.css";

export function BoardColumns({ tasks, project, onOpen, onCreate, onMove }: BoardColumnsProps) {
  const columns = project.availableStatuses
    .map((status) => ({ status, statusTasks: tasks.filter((task) => task.status === status) }))
    .filter((column) => column.statusTasks.length > 0 || !(project.hiddenEmptyStatuses ?? project.availableStatuses).includes(column.status));
  const hidden = project.hiddenEmptyStatuses ?? project.availableStatuses;
  const visible = columns.length > 0
    ? columns
    : project.availableStatuses.filter((status) => !hidden.includes(status)).map((status) => ({ status, statusTasks: [] as typeof tasks }));

  return (
    <div className={styles.board} style={{ "--status-count": visible.length } as CSSProperties}>
      {visible.map(({ status, statusTasks }) => (
        <section
          className={styles.column}
          key={status}
          aria-label={`${statusMeta[status].label} tasks`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/task-id");
            if (id) onMove(id, status);
          }}
        >
          <header>
            <span className={`status-dot ${statusMeta[status].tone}`} />
            <strong>{statusMeta[status].label}</strong>
            <span>{statusTasks.length}</span>
            <button type="button" onClick={() => onCreate(status)}><Plus /></button>
          </header>
          <div className={styles.body}>
            {statusTasks.map((task) => (
              <TaskCard key={task.id} task={task} project={project} onOpen={() => onOpen(task)} />
            ))}
            <button type="button" className={styles.addQuiet} onClick={() => onCreate(status)}>
              <Plus /> Add task
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
