import type { DependencyResolutionStatus, Task, TaskDependency } from "@taskforge/contracts";

export type TaskDependencyPillsProps = {
  dependencies: TaskDependency[];
  limit?: number;
};

export type TaskDependencyEditorProps = {
  value: string[];
  tasks: Task[];
  projectKey: string;
  currentTaskId?: string;
  resolutionStatuses: DependencyResolutionStatus[];
  onChange: (ids: string[]) => void;
};
