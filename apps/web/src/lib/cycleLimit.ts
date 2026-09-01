import type { Project, User } from "@taskforge/contracts";
import type { AgentCycleState } from "./api.js";

export function canForceCycle(user: User, project: Project, cycle: AgentCycleState | null) {
  return Boolean(cycle?.limitFailure && user.kind === "HUMAN" && (user.role === "ADMIN" || user.id === project.ownerId));
}

export function forceCycleRequestId(taskId: string, priorCount: number) {
  return `force-cycle:${taskId}:${priorCount}`;
}

export const FORCE_CYCLE_FAILURE_MESSAGE = "Could not start the additional cycle. The grant is safe to retry and will not be duplicated.";
