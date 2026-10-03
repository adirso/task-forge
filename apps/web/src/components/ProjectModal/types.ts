import type { AgentWorkflow, DependencyResolutionStatus, Project, ProjectReviewPolicy, TaskStatus } from "@taskforge/contracts";

export type ProjectFormInput = {
  sourceProjectId?: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string | null;
  localRepoPath: string | null;
  color: string;
  availableStatuses?: TaskStatus[];
  defaultStatus?: TaskStatus;
  agentWorkflow?: AgentWorkflow | null;
  hiddenEmptyStatuses?: TaskStatus[];
  mergeTarget?: "main" | "phase";
  dependencyResolutionStatuses?: DependencyResolutionStatus[];
  reviewPolicy?: ProjectReviewPolicy;
};

export type ProjectModalProps = {
  project?: Project | null;
  projects?: Project[];
  sourceProjects?: Project[];
  onClose: () => void;
  onSave: (project: ProjectFormInput) => Promise<void>;
  onEnableWorkflow?: () => Promise<void>;
};
