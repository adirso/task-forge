import type { Project, Task, TaskStatus } from "@taskforge/contracts";
import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import { statusMeta } from "../lib/ui";
import { TaskCard } from "./TaskCard";

export function BoardView({ tasks, project, onOpen, onCreate, onMove }: {
  tasks: Task[]; project: Project; onOpen: (task: Task) => void; onCreate: (status: TaskStatus) => void; onMove: (id: string, status: TaskStatus) => void;
}) {
  return (
    <div className="board" style={{ "--status-count": project.availableStatuses.length, "--board-min-width": `${project.availableStatuses.length * 242}px` } as CSSProperties}>
      {project.availableStatuses.map((status) => {
        const statusTasks = tasks.filter((task) => task.status === status);
        return (
          <section className="board-column" key={status} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/task-id"); if (id) onMove(id, status); }}>
            <header><span className={`status-dot ${statusMeta[status].tone}`} /> <strong>{statusMeta[status].label}</strong><span>{statusTasks.length}</span><button onClick={() => onCreate(status)}><Plus /></button></header>
            <div className="column-body">
              {statusTasks.map((task) => <TaskCard key={task.id} task={task} project={project} onOpen={() => onOpen(task)} />)}
              <button className="add-task-quiet" onClick={() => onCreate(status)}><Plus /> Add task</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
