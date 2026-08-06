import type { UserKind, UserRole } from "@taskforge/contracts";

/** The only actor information an application service should need from HTTP auth. */
export interface ActorContext {
  userId: string;
  name?: string;
  kind: UserKind;
  role: UserRole;
}

export interface RequestContext {
  actor: ActorContext;
  correlationId?: string;
}

export interface ProjectContext extends RequestContext {
  projectId: string;
}
