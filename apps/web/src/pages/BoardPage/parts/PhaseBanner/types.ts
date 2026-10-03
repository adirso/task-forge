import type { Phase, Project, User } from "@taskforge/contracts";

export type PhaseBannerProps = {
  project: Project;
  phases: Phase[];
  selectedPhase: Phase;
  taskCount: number;
  currentUser: User;
  onPhaseChange: (phaseId: string) => void;
  onManagePhases: () => void;
  onMergePhase: () => void;
};
