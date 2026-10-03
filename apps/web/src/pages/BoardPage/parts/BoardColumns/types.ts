import type { Project, Task, TaskStatus } from "@taskforge/contracts";

export type BoardColumnsProps = {
  tasks: Task[];
  project: Project;
  onOpen: (task: Task) => void;
  onCreate: (status: TaskStatus) => void;
  onMove: (id: string, status: TaskStatus) => void;
};
