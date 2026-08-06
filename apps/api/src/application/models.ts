import type { PullRequestState, TaskPriority, TaskStatus, UserKind, UserRole } from "@taskforge/contracts";

export interface UserEntity {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
  createdAt: string;
}

export interface ProjectEntity {
  id: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string | null;
  color: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseEntity {
  id: string;
  projectId: string;
  number: number;
  goal: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEntity {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  definitionOfDone: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  creatorId: string;
  parentId: string | null;
  branch: string | null;
  dueDate: string | null;
  estimatePoints: number | null;
  phaseId: string | null;
  pullRequestUrl: string | null;
  pullRequestTitle: string | null;
  pullRequestState: PullRequestState | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependencyEntity {
  taskId: string;
  dependsOnTaskId: string;
  projectId: string;
  number: number;
  title: string;
  status: TaskStatus;
}

export interface TaskTagEntity {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

export interface TaskUpdateEntity {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiTokenEntity {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface NotificationEntity {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total?: number;
}
