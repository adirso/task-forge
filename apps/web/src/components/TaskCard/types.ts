import type { Project, Task } from "@taskforge/contracts";

export type TaskCardProps = {
  task: Task;
  project: Project;
  onOpen: () => void;
};
