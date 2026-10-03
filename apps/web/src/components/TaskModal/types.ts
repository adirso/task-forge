import type { Phase, Project, Tag, Task, TaskCreate, User } from "@taskforge/contracts";

export type TaskModalTab = "details" | "updates" | "plans" | "agents";

export type TaskModalProps = {
  task: Task | null;
  initialStatus: Task["status"];
  defaultPhaseId: string | null;
  project: Project;
  currentUser: User;
  members: User[];
  phases: Phase[];
  availableTags: Tag[];
  tasks: Task[];
  onClose: () => void;
  onSave: (input: TaskCreate) => Promise<void>;
  onDelete: (() => Promise<void>) | null;
  onRouted?: (task: Task) => void;
  onPlanApplied?: () => Promise<void>;
};
