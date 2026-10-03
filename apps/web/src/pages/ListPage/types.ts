import type { Phase, Project, Task } from "@taskforge/contracts";

export type ListPageProps = {
  tasks: Task[];
  phases: Phase[];
  project: Project;
  onOpen: (task: Task) => void;
};
