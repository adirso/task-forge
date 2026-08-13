import type { UserKind, UserRole } from "@taskforge/contracts";

/**
 * Token scopes that restrict what an API token can do.
 * null = unrestricted (human JWT or token with no scope list).
 * string[] = the token may only perform operations covered by these scopes.
 *
 * Defined scopes:
 *   task:read          — list and get tasks (always granted)
 *   task:create        — create new tasks
 *   task:delete        — delete tasks
 *   task:claim         — claim the next unassigned task
 *   task:update:status — change task status
 *   task:update:notes  — post progress notes / updates
 *   task:update:branch — update branch and pull-request fields
 *   task:update:meta   — update title, description, priority, type, assignee, phase, etc.
 */
export type TokenScope =
  | "task:read"
  | "task:create"
  | "task:delete"
  | "task:claim"
  | "task:update:status"
  | "task:update:notes"
  | "task:update:branch"
  | "task:update:meta";

/** The only actor information an application service should need from HTTP auth. */
export interface ActorContext {
  userId: string;
  name?: string;
  kind: UserKind;
  role: UserRole;
  /** null = unrestricted; string[] = explicit allow-list of scopes */
  tokenScopes: TokenScope[] | null;
}

export interface RequestContext {
  actor: ActorContext;
  correlationId?: string;
}

export interface ProjectContext extends RequestContext {
  projectId: string;
}
