import type { Project, Task, TaskStatus } from "@taskforge/contracts";
import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import { statusMeta } from "../lib/ui";
import { TaskCard } from "./TaskCard";

export function BoardView({ tasks, project, onOpen, onCreate, onMove }: {
  tasks: Task[]; project: Project; onOpen: (task: Task) => void; onCreate: (status: TaskStatus) => void; onMove: (id: string, status: TaskStatus) => void;
}) {
  const columns = project.availableStatuses
    .map((status) => ({ status, statusTasks: tasks.filter((task) => task.status === status) }))
    .filter((column) => column.statusTasks.length > 0 || !(project.hiddenEmptyStatuses ?? project.availableStatuses).includes(column.status));
  const hidden = project.hiddenEmptyStatuses ?? project.availableStatuses;
  const visible = columns.length > 0 ? columns : project.availableStatuses.filter((status) => !hidden.includes(status)).map((status) => ({ status, statusTasks: [] as Task[] }));

  return (
    <div className="board" style={{ "--status-count": visible.length } as CSSProperties}>
      {visible.map(({ status, statusTasks }) => (
        <section className="board-column" key={status} aria-label={`${statusMeta[status].label} tasks`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/task-id"); if (id) onMove(id, status); }}>
          <header><span className={`status-dot ${statusMeta[status].tone}`} /> <strong>{statusMeta[status].label}</strong><span>{statusTasks.length}</span><button onClick={() => onCreate(status)}><Plus /></button></header>
          <div className="column-body">
            {statusTasks.map((task) => <TaskCard key={task.id} task={task} project={project} onOpen={() => onOpen(task)} />)}
            <button className="add-task-quiet" onClick={() => onCreate(status)}><Plus /> Add task</button>
          </div>
        </section>
      ))}
    </div>
  );
}
