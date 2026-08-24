import type { PullRequestState, TaskPriority, TaskStatus, TaskType, UserKind, UserRole, WebhookDeliveryStatus, WebhookEventType } from "@taskforge/contracts";

export interface UserEntity {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
  webhookUrl?: string | null;
  webhookSecretConfigured?: boolean;
  createdAt: string;
}

export interface WebhookDeliveryEntity {
  id: string;
  agentId: string;
  taskId: string | null;
  eventType: WebhookEventType;
  payload: string;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lockedUntil: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  httpStatus: number | null;
  createdAt: string;
  updatedAt: string;
  agentName?: string;
  taskNumber?: number | null;
  projectKey?: string | null;
}

export type AgentRunKind = "IMPLEMENTATION" | "REVIEW" | "RE_REVIEW" | "FIX";
export type AgentRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export interface AgentRunEntity {
  id: string;
  taskId: string;
  projectId: string;
  requestedById: string;
  kind: AgentRunKind;
  status: AgentRunStatus;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  timeoutAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type GateCheckStatus = "PASS" | "FAIL" | "PENDING";
export interface TaskGateEntity {
  taskId: string;
  headSha: string;
  requiredChecks: string[];
  checks: Array<{ name: string; status: GateCheckStatus; headSha: string; detailsUrl?: string | null }>;
  approvedHeadSha: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  mergedHeadSha: string | null;
  mergedById: string | null;
  mergedAt: string | null;
  updatedAt: string;
}

export type FindingSeverity = "P0" | "P1" | "P2" | "P3";
export type FindingDisposition = "OPEN" | "ACCEPTED" | "FIX_NEEDED" | "DEFERRED" | "REJECTED" | "ESCALATED";
export interface TaskFindingEntity {
  id: string;
  taskId: string;
  runId: string | null;
  authorId: string;
  severity: FindingSeverity;
  title: string;
  body: string;
  filePath: string | null;
  lineNumber: number | null;
  disposition: FindingDisposition;
  dispositionById: string | null;
  dispositionReason: string | null;
  decisionOwnerId: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWebhookConfiguration {
  webhookUrl: string | null;
  secretCiphertext: string | null;
  secretVersion: number;
}

export interface ActivityEntity {
  id: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskNumber: number | null;
  actorId: string;
  actorName: string;
  actorKind: UserKind;
  actorAvatarUrl: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ReportingTaskEntity {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  updatedAt: string;
}

export interface TaskStatusCountEntity {
  projectId: string;
  status: TaskStatus;
  count: number;
}

export interface ProjectPhaseMetricEntity {
  projectId: string;
  nonDonePhaseCount: number;
}

export interface AgentLastActiveEntity {
  agentId: string;
  lastActiveAt: string | null;
}

export interface AutomationConditionEntity { field: "status" | "priority" | "type" | "assigneeId" | "pullRequestState" | "phaseId" | "branch" | "estimatePoints"; operator: "equals" | "not_equals" | "changed_to" | "is_empty" | "is_not_empty"; value: string | null; }
export interface AutomationActionEntity { field: AutomationConditionEntity["field"]; valueType: "static" | "actor" | "user" | "service" | "null"; value: string | null; }
export interface AutomationEntity { id: string; projectId: string; name: string; enabled: boolean; trigger: "TASK_CREATED" | "TASK_UPDATED"; actorType: "ANY" | "USER" | "SERVICE"; actorId: string | null; service: string | null; conditions: AutomationConditionEntity[]; actions: AutomationActionEntity[]; createdAt: string; updatedAt: string; }

export interface ProjectEntity {
  id: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string | null;
  color: string;
  sortOrder: number;
  availableStatuses: TaskStatus[];
  defaultStatus: TaskStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  members?: Array<UserEntity & { projectRole: "OWNER" | "MEMBER" }>;
  taskCount?: number;
}

export interface PhaseEntity {
  id: string;
  projectId: string;
  number: number;
  goal: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
  nonDoneTaskCount?: number;
  completedTaskCount?: number;
  cancelledTaskCount?: number;
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
  type: TaskType;
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
  statusDurations?: Partial<Record<TaskStatus, number>>;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee?: UserEntity | null;
  phase?: PhaseEntity | null;
  tags?: TaskTagEntity[];
  dependencies?: TaskDependencyEntity[];
  attachments?: AttachmentEntity[];
  updates?: TaskUpdateEntity[];
  updatesPage?: PageInfo;
  projectName?: string;
  projectKey?: string;
  projectColor?: string;
}

export interface TaskDependencyEntity {
  taskId: string;
  dependsOnTaskId: string;
  projectId: string;
  number: number;
  title: string;
  status: TaskStatus;
  projectKey?: string;
  isBlocking?: boolean;
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
  author?: UserEntity;
}

export interface AttachmentEntity {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedById: string;
  createdAt: string;
  uploadedBy?: UserEntity;
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
  revealable: boolean;
  ciphertext?: string | null;
  permissions: string[] | null;
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
  projectName?: string | null;
  projectKey?: string | null;
  taskNumber?: number | null;
}

export interface Page<T> {
  items: T[];
  page: PageInfo;
}

export interface PageRequest {
  cursor?: string;
  limit: number;
}

export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}
