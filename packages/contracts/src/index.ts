import { z } from "zod";

export const userKindSchema = z.enum(["HUMAN", "AGENT"]);
export const userRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export const projectMemberRoleSchema = z.enum(["OWNER", "MEMBER"]);
export const TASK_STATUSES = ["BACKLOG", "REFINING", "TODO", "READY_FOR_DEV", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "DONE", "CANCELLED"] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const projectAvailableStatusesSchema = z.array(taskStatusSchema)
  .min(1, "At least one status must be available")
  .max(TASK_STATUSES.length)
  .refine((statuses) => new Set(statuses).size === statuses.length, "Statuses must be unique")
  .transform((statuses) => TASK_STATUSES.filter((status) => statuses.includes(status)));
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const taskTypeSchema = z.enum(["FEATURE", "BUG", "INFRA", "UPDATE", "SECURITY", "DOCS", "CHORE"]);
export const pullRequestStateSchema = z.enum(["DRAFT", "OPEN", "MERGED", "CLOSED"]);
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
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6554C0"),
});

export const projectUpdateSchema = projectCreateSchema.omit({ key: true }).partial().extend({
  availableStatuses: projectAvailableStatusesSchema.optional(),
  defaultStatus: taskStatusSchema.optional(),
});
export const projectOrderSchema = z.object({ projectIds: z.array(z.string().uuid()).min(1).max(500) });

export const phaseCreateSchema = z.object({
  number: z.number().int().min(1).max(10000),
  goal: z.string().trim().min(1).max(1000),
  isActive: z.boolean().default(false),
});

export const phaseUpdateSchema = phaseCreateSchema.partial();

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
  webhookUrl: z.string().url().nullable(),
});

export const taskClaimSchema = z.object({
  phaseId: z.string().uuid().nullable().optional(),
  priority: taskPrioritySchema.optional(),
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
export const automationOperatorSchema = z.enum(["equals", "not_equals", "changed_to", "is_empty", "is_not_empty"]);
export const automationConditionSchema = z.object({ field: automationFieldSchema, operator: automationOperatorSchema, value: z.string().nullable().default(null) });
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
  createdAt: string;
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
  color: string;
  sortOrder: number;
  availableStatuses: TaskStatus[];
  defaultStatus: TaskStatus;
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
}

export interface AutomationCondition { field: z.infer<typeof automationFieldSchema>; operator: z.infer<typeof automationOperatorSchema>; value: string | null; }
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
