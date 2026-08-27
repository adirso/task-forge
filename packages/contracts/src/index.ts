import { z } from "zod";

export const userKindSchema = z.enum(["HUMAN", "AGENT"]);
export const userRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export const projectMemberRoleSchema = z.enum(["OWNER", "MEMBER"]);
// Keep the canonical order aligned with the delivery workflow. Project subsets
// are normalized against this list, so this also controls board column order.
export const TASK_STATUSES = ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "FIX_NEEDED", "FIX_IN_PROGRESS", "RE_REVIEW", "APPROVED", "PENDING_DECISION", "CANCELLED", "FAILED", "DONE"] as const;
export const DEFAULT_PROJECT_STATUSES = ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "CANCELLED", "DONE"] as const;
export const TASK_CLAIM_SOURCE_STATUSES = ["BACKLOG", "TODO"] as const;
export const TASK_CLAIM_TARGET_STATUS = "IN_PROGRESS" as const;
export const TASK_REVIEW_STATUSES = ["READY_FOR_REVIEW", "IN_REVIEW", "RE_REVIEW"] as const;
export const TASK_COMPLETION_STATUS = "DONE" as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const projectAvailableStatusesSchema = z.array(taskStatusSchema)
  .min(1, "At least one status must be available")
  .max(TASK_STATUSES.length)
  .refine((statuses) => new Set(statuses).size === statuses.length, "Statuses must be unique")
  .transform((statuses) => TASK_STATUSES.filter((status) => statuses.includes(status)));
export const agentWorkflowSchema = z.object({
  implementationQueue: taskStatusSchema,
  implementationStart: taskStatusSchema,
  reviewHandoff: taskStatusSchema,
  reviewStart: taskStatusSchema,
  approved: taskStatusSchema,
  fixNeeded: taskStatusSchema,
  fixStart: taskStatusSchema,
  reReview: taskStatusSchema,
});
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>;
export const DEFAULT_AGENT_WORKFLOW: AgentWorkflow = {
  implementationQueue: "TODO",
  implementationStart: "IN_PROGRESS",
  reviewHandoff: "READY_FOR_REVIEW",
  reviewStart: "IN_REVIEW",
  approved: "APPROVED",
  fixNeeded: "FIX_NEEDED",
  fixStart: "FIX_IN_PROGRESS",
  reReview: "RE_REVIEW",
};
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const taskTypeSchema = z.enum(["FEATURE", "BUG", "INFRA", "UPDATE", "SECURITY", "DOCS", "CHORE"]);
export const pullRequestStateSchema = z.enum(["DRAFT", "OPEN", "MERGED", "CLOSED"]);
/** Pull requests are intentionally restricted to canonical public GitHub URLs. */
export const deliveryMonitorPullRequestSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  number: z.number().int().positive(),
  url: z.string().url(),
});
export const deliveryMonitorErrorCategorySchema = z.enum([
  "AUTHENTICATION", "PERMISSION", "RATE_LIMIT", "NOT_FOUND", "INVALID_URL", "NETWORK", "TIMEOUT", "UNKNOWN",
]);
export const deliveryMonitorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  githubAppId: z.string().trim().min(1).optional(),
  githubInstallationId: z.string().trim().min(1).optional(),
  githubPrivateKey: z.string().trim().min(1).optional(),
  pollIntervalMs: z.number().int().min(5_000).max(900_000).default(60_000),
  batchSize: z.number().int().min(1).max(500).default(100),
  leaseDurationMs: z.number().int().min(5_000).max(900_000).default(120_000),
}).superRefine((value, context) => {
  const configured = [value.githubAppId, value.githubInstallationId, value.githubPrivateKey].filter(Boolean).length;
  if (configured > 0 && configured < 3) context.addIssue({ code: "custom", path: ["githubAppId"], message: "githubAppId, githubInstallationId, and githubPrivateKey must be configured together" });
});
export const deliveryMonitorSyncResultSchema = z.object({
  taskId: z.string().uuid(),
  pullRequestUrl: z.string().url(),
  state: pullRequestStateSchema,
  observedAt: z.string().datetime(),
  destinationStatus: z.enum(["DONE", "CANCELLED"]).nullable(),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).nullable(),
  errorCategory: deliveryMonitorErrorCategorySchema.nullable(),
});
export const deliveryMonitorCheckpointSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  cursor: z.string().nullable(),
  etag: z.string().max(512).nullable().default(null),
  retryCount: z.number().int().nonnegative().default(0),
  nextAttemptAt: z.string().datetime().nullable().default(null),
  observedAt: z.string().datetime(),
  lastResult: deliveryMonitorSyncResultSchema.nullable(),
});
export const deliveryMonitorLeaseSchema = z.object({
  runId: z.string().uuid(),
  ownerId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const deliveryMonitorAuditEventSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  event: z.enum(["SYNC_STARTED", "SYNC_COMPLETED", "SYNC_FAILED", "LEASE_RECLAIMED"]),
  occurredAt: z.string().datetime(),
  errorCategory: deliveryMonitorErrorCategorySchema.nullable(),
});
export const webhookEventTypeSchema = z.enum(["task.assigned", "task.update_added", "task.status_changed"]);
export const webhookDeliveryStatusSchema = z.enum(["PENDING", "RETRYING", "DELIVERED", "FAILED"]);
export const taskTagNameSchema = z.string().trim().min(1).max(32)
  .regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/, "Tags may contain letters, numbers, hyphens, and underscores")
  .transform((value) => value.toLowerCase());
export const taskTagsSchema = z.array(taskTagNameSchema).max(20)
  .transform((values) => [...new Set(values)]);
export const taskDependencyIdsSchema = z.array(z.string().uuid()).max(50)
  .transform((values) => [...new Set(values)]);
export const taskDependencyUpdateSchema = z.object({ dependencyIds: taskDependencyIdsSchema });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const projectCreateSchema = z.object({
  key: z.string().trim().min(2).max(8).regex(/^[A-Za-z][A-Za-z0-9]*$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  repoUrl: z.string().url().nullable().optional(),
  localRepoPath: z.string().trim().min(1).max(2048).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6554C0"),
});

export const projectUpdateSchema = projectCreateSchema.omit({ key: true }).partial().extend({
  availableStatuses: projectAvailableStatusesSchema.optional(),
  defaultStatus: taskStatusSchema.optional(),
  agentWorkflow: agentWorkflowSchema.nullable().optional(),
  hiddenEmptyStatuses: projectAvailableStatusesSchema.optional(),
});
export const projectOrderSchema = z.object({ projectIds: z.array(z.string().uuid()).min(1).max(500) });

export const phaseCreateSchema = z.object({
  number: z.number().int().min(1).max(10000),
  goal: z.string().trim().min(1).max(1000),
  isActive: z.boolean().default(false),
});

export const phaseUpdateSchema = phaseCreateSchema.partial();

export const phaseDeleteSchema = z.object({
  taskAction: z.enum(["move", "delete"]).optional(),
  targetPhaseId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.taskAction === "move" && !value.targetPhaseId) {
    context.addIssue({ code: "custom", path: ["targetPhaseId"], message: "Choose a phase to move tasks into" });
  }
  if (value.targetPhaseId && value.taskAction !== "move") {
    context.addIssue({ code: "custom", path: ["taskAction"], message: "taskAction must be move when targetPhaseId is set" });
  }
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10000).default(""),
  definitionOfDone: z.string().trim().max(10000).default(""),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.default("MEDIUM"),
  type: taskTypeSchema.default("FEATURE"),
  assigneeId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  branch: z.string().trim().max(255).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  estimatePoints: z.number().int().min(0).max(100).nullable().optional(),
  phaseId: z.string().uuid().nullable().optional(),
  pullRequestUrl: z.string().url().nullable().optional(),
  pullRequestTitle: z.string().trim().max(240).nullable().optional(),
  pullRequestState: pullRequestStateSchema.nullable().optional(),
  tags: taskTagsSchema.optional(),
  dependencyIds: taskDependencyIdsSchema.optional(),
});

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
  runId: z.string().uuid().nullable().optional(),
});

export const memberAddSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
});

export const agentCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().optional(),
});

export const agentWebhookSchema = z.object({
  webhookUrl: z.string().url().nullable().superRefine((value, context) => {
    if (!value) return;
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) context.addIssue({ code: "custom", message: "Webhook URLs must use HTTP or HTTPS" });
    if (url.username || url.password) context.addIssue({ code: "custom", message: "Webhook URLs must not contain credentials" });
  }),
});

export const webhookDeliveryQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  status: webhookDeliveryStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const taskClaimSchema = z.object({
  phaseId: z.string().uuid().nullable().optional(),
  priority: taskPrioritySchema.optional(),
  runId: z.string().uuid().nullable().optional(),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
});

export const TOKEN_SCOPES = [
  "task:read",
  "task:create",
  "task:delete",
  "task:claim",
  "task:update:status",
  "task:update:notes",
  "task:update:branch",
  "task:update:meta",
  "task:gate:evidence",
  "task:gate:approve",
] as const;
export type TokenScope = typeof TOKEN_SCOPES[number];

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  permissions: z.array(z.enum(TOKEN_SCOPES)).nullable().optional(),
});

export const taskUpdateCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  data: z.string().min(1).max(35_000_000),
});

export const avatarUploadSchema = z.object({
  mimeType: z.string().regex(/^image\/(png|jpeg|jpg|gif|webp)$/i, "Profile pictures must be PNG, JPEG, GIF, or WebP images"),
  data: z.string().min(1).max(4_000_000),
});

export const automationFieldSchema = z.enum(["status", "priority", "type", "assigneeId", "pullRequestState", "phaseId", "branch", "estimatePoints"]);
export const automationOperatorSchema = z.enum(["equals", "not_equals", "changed_to", "changed_from_to", "is_empty", "is_not_empty"]);
export const automationConditionSchema = z.object({ field: automationFieldSchema, operator: automationOperatorSchema, value: z.string().nullable().default(null), fromValue: z.string().nullable().optional() });
export const automationValueTypeSchema = z.enum(["static", "actor", "user", "service", "null"]);
export const automationActionSchema = z.object({ field: automationFieldSchema, valueType: automationValueTypeSchema, value: z.string().nullable().default(null) });
export const automationCreateSchema = z.object({ name: z.string().trim().min(2).max(120), enabled: z.boolean().default(true), trigger: z.enum(["TASK_CREATED", "TASK_UPDATED"]).default("TASK_UPDATED"), actorType: z.enum(["ANY", "USER", "SERVICE"]).default("ANY"), actorId: z.string().uuid().nullable().optional(), service: z.string().trim().max(80).nullable().optional(), conditions: z.array(automationConditionSchema).max(10).default([]), actions: z.array(automationActionSchema).min(1).max(10) });
export const automationUpdateSchema = automationCreateSchema.partial();

export type UserKind = z.infer<typeof userKindSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;
export type DeliveryMonitorConfig = z.infer<typeof deliveryMonitorConfigSchema>;
export type DeliveryMonitorPullRequest = z.infer<typeof deliveryMonitorPullRequestSchema>;
export type DeliveryMonitorErrorCategory = z.infer<typeof deliveryMonitorErrorCategorySchema>;
export type DeliveryMonitorSyncResult = z.infer<typeof deliveryMonitorSyncResultSchema>;
export type DeliveryMonitorCheckpoint = z.infer<typeof deliveryMonitorCheckpointSchema>;
export type DeliveryMonitorLease = z.infer<typeof deliveryMonitorLeaseSchema>;
export type DeliveryMonitorAuditEvent = z.infer<typeof deliveryMonitorAuditEventSchema>;

const GITHUB_PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
export function parseDeliveryMonitorPullRequestUrl(value: string): DeliveryMonitorPullRequest | null {
  const match = GITHUB_PR_URL.exec(value.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const url = `https://github.com/${match[1]}/${match[2]}/pull/${number}`;
  return deliveryMonitorPullRequestSchema.parse({ owner: match[1], repository: match[2], number, url });
}

export function mapGithubPullRequestState(state: "open" | "closed", mergedAt: string | null, draft = false): PullRequestState {
  if (mergedAt) return "MERGED";
  if (state === "closed") return "CLOSED";
  return draft ? "DRAFT" : "OPEN";
}

/** Ensure a project can receive every terminal result produced by the monitor. */
export function validateDeliveryMonitorDestinations(availableStatuses: readonly string[]): { merged: "DONE"; closed: "CANCELLED" } {
  const missing = (["DONE", "CANCELLED"] as const).filter((status) => !availableStatuses.includes(status));
  if (missing.length) throw new Error(`Delivery Monitor requires enabled destination status(es): ${missing.join(", ")}`);
  return { merged: "DONE", closed: "CANCELLED" };
}
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type AutomationCreate = z.infer<typeof automationCreateSchema>;
export type AutomationUpdate = z.infer<typeof automationUpdateSchema>;

export interface User {
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

export interface WebhookDelivery {
  id: string;
  agentId: string;
  agentName: string;
  taskId: string | null;
  taskNumber: number | null;
  projectKey: string | null;
  eventType: WebhookEventType;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  httpStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember extends User {
  projectRole: ProjectMemberRole;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string | null;
  localRepoPath: string | null;
  color: string;
  sortOrder: number;
  availableStatuses: TaskStatus[];
  defaultStatus: TaskStatus;
  agentWorkflow: AgentWorkflow | null;
  hiddenEmptyStatuses: TaskStatus[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
  members?: ProjectMember[];
}

export interface Phase {
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

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  taskCount?: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  projectId: string;
  projectKey: string;
  number: number;
  title: string;
  status: TaskStatus;
  isBlocking: boolean;
}

export interface Task {
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
  assignee?: User | null;
  phase?: Phase | null;
  creator?: User;
  subtasks?: Task[];
  tags: Tag[];
  dependencies: TaskDependency[];
  attachments: Attachment[];
  updates?: TaskNote[];
  updatesPage?: PageInfo;
}

export interface AutomationCondition { field: z.infer<typeof automationFieldSchema>; operator: z.infer<typeof automationOperatorSchema>; value: string | null; fromValue?: string | null; }
export interface AutomationAction { field: z.infer<typeof automationFieldSchema>; valueType: z.infer<typeof automationValueTypeSchema>; value: string | null; }
export interface Automation { id: string; projectId: string; name: string; enabled: boolean; trigger: "TASK_CREATED" | "TASK_UPDATED"; actorType: "ANY" | "USER" | "SERVICE"; actorId: string | null; service: string | null; conditions: AutomationCondition[]; actions: AutomationAction[]; createdAt: string; updatedAt: string; }

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: User;
  downloadUrl: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: User;
}

export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Notification {
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

export interface TaskSearchResult extends Task {
  projectName: string;
  projectKey: string;
  projectColor: string;
}

export interface ActivityEvent {
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

export interface AgentOpsTask {
  id: string;
  title: string;
  number: number;
  projectId: string;
  projectName: string;
  projectKey: string;
  updatedAt: string;
  isStuck: boolean;
}

export interface AgentOpsEntry {
  id: string;
  name: string;
  email: string | null;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
  webhookUrl: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  openTaskCount: number;
  stuckTaskCount: number;
  inProgressTasks: AgentOpsTask[];
}

export interface DashboardSummaryProject {
  id: string;
  name: string;
  key: string;
  color: string;
  counts: Record<TaskStatus, number> & { total: number };
  nonDoneTaskCount: number;
  cancelledTaskCount: number;
  nonDonePhaseCount: number;
}

export interface DashboardSummaryTask {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  status: TaskStatus;
  assigneeName: string | null;
  updatedAt: string;
}

export interface DashboardSummary {
  projects: DashboardSummaryProject[];
  myTasks: DashboardSummaryTask[];
  stuckTasks: DashboardSummaryTask[];
}

export interface ApiTokenMetadata {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  revealable: boolean;
  permissions: TokenScope[] | null;
}
