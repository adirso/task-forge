import type { Phase, Project } from "@taskforge/contracts";

export type PhaseListChange = {
  phases: Phase[];
  deletedPhaseId?: string;
  taskAction?: "move" | "delete";
  targetPhaseId?: string;
};

export interface PhasesPageProps {
  project: Project;
  phases: Phase[];
  onChange: (change: PhaseListChange) => void;
}
