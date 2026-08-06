import { z } from "zod";

export const userKindSchema = z.enum(["HUMAN", "AGENT"]);
export const userRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export const projectMemberRoleSchema = z.enum(["OWNER", "MEMBER"]);
export const taskStatusSchema = z.enum(["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const pullRequestStateSchema = z.enum(["DRAFT", "OPEN", "MERGED", "CLOSED"]);
export const taskTagNameSchema = z.string().trim().min(1).max(32)
  .regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/, "Tags may contain letters, numbers, hyphens, and underscores")
  .transform((value) => value.toLowerCase());
export const taskTagsSchema = z.array(taskTagNameSchema).max(20)
  .transform((values) => [...new Set(values)]);

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

export const projectUpdateSchema = projectCreateSchema.omit({ key: true }).partial();

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
  status: taskStatusSchema.default("TODO"),
  priority: taskPrioritySchema.default("MEDIUM"),
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

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
});

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
});

export const taskUpdateCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export type UserKind = z.infer<typeof userKindSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
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

export interface Task {
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
  assignee?: User | null;
  creator?: User;
  subtasks?: Task[];
  tags: Tag[];
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

export interface ApiTokenMetadata {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
