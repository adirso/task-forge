import type { WorkflowStatusCategory } from "./models.js";

export const SYSTEM_DEFAULT_WORKFLOW_ID = "00000000-0000-4000-8000-000000000042";

export interface DefaultWorkflowStatusDefinition {
  id: string;
  key: string;
  label: string;
  color: string;
  category: WorkflowStatusCategory;
  position: number;
  isInitial: boolean;
  isClaimable: boolean;
  isClaimTarget: boolean;
  triggersReview: boolean;
  tracksStaleness: boolean;
  satisfiesDependencies: boolean;
}

export const DEFAULT_WORKFLOW_STATUSES: readonly DefaultWorkflowStatusDefinition[] = [
  { id: "00000000-0000-4000-8000-000000000101", key: "BACKLOG", label: "Backlog", color: "#6B778C", category: "NOT_STARTED", position: 0, isInitial: false, isClaimable: true, isClaimTarget: false, triggersReview: false, tracksStaleness: false, satisfiesDependencies: false },
  { id: "00000000-0000-4000-8000-000000000102", key: "TODO", label: "To do", color: "#0C66E4", category: "NOT_STARTED", position: 1, isInitial: true, isClaimable: true, isClaimTarget: false, triggersReview: false, tracksStaleness: false, satisfiesDependencies: false },
  { id: "00000000-0000-4000-8000-000000000103", key: "IN_PROGRESS", label: "In progress", color: "#6554C0", category: "ACTIVE", position: 2, isInitial: false, isClaimable: false, isClaimTarget: true, triggersReview: false, tracksStaleness: true, satisfiesDependencies: false },
  { id: "00000000-0000-4000-8000-000000000104", key: "IN_REVIEW", label: "In review", color: "#F59E0B", category: "ACTIVE", position: 3, isInitial: false, isClaimable: false, isClaimTarget: false, triggersReview: true, tracksStaleness: false, satisfiesDependencies: false },
  { id: "00000000-0000-4000-8000-000000000105", key: "DONE", label: "Done", color: "#22A06B", category: "COMPLETED", position: 4, isInitial: false, isClaimable: false, isClaimTarget: false, triggersReview: false, tracksStaleness: false, satisfiesDependencies: true },
] as const;
