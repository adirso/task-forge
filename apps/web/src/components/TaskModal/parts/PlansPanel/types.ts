import type { AgentPlan, Project, Task } from "@taskforge/contracts";

export type PlansPanelProps = {
  project: Project;
  plans: AgentPlan[];
  tasksById: Map<string, Task>;
  canControlRuns: boolean;
  reviewingPlan: string | null;
  onReviewPlan: (plan: AgentPlan, action: "APPROVE" | "REJECT") => void;
};
