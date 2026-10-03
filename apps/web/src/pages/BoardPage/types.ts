import type { Phase, Project, Task, TaskStatus, User } from "@taskforge/contracts";

export type BoardPageProps = {
  project: Project;
  phases: Phase[];
  selectedPhase: Phase | null;
  tasks: Task[];
  hasTasksInSelectedPhase: boolean;
  currentUser: User;
  onPhaseChange: (phaseId: string) => void;
  onOpen: (task: Task) => void;
  onCreate: (status: TaskStatus) => void;
  onMove: (id: string, status: TaskStatus) => void;
  onManagePhases: () => void;
  onMergePhase: () => void;
};
