import type { ProjectContext, RequestContext } from "./context.js";
import type { ApiTokenEntity, AttachmentEntity, NotificationEntity, PhaseEntity, ProjectEntity, TaskEntity, TaskUpdateEntity, UserEntity } from "./models.js";

export type ProjectCreateInput = Omit<ProjectEntity, "id" | "ownerId" | "createdAt" | "updatedAt" | "sortOrder">;
type TaskInputFields = Partial<Omit<TaskEntity, "id" | "projectId" | "number" | "creatorId" | "position" | "createdAt" | "updatedAt" | "assignee" | "tags" | "dependencies">> & Pick<TaskEntity, "title">;
export type TaskCreateInput = TaskInputFields & { tags?: string[]; dependencyIds?: string[] };
export type TaskUpdateInput = Partial<TaskInputFields> & { tags?: string[]; dependencyIds?: string[] };
export interface TaskFilters {
  status?: string;
  assigneeId?: string;
  priority?: string;
  type?: string;
  phaseId?: string;
  tag?: string;
  minPoints?: number;
  maxPoints?: number;
  query?: string;
}

export interface AuthService {
  authenticate(input: { email: string; password: string }): Promise<{ user: UserEntity; token: string }>;
  currentUser(context: RequestContext): Promise<UserEntity>;
}

export interface ContextService {
  resolve(context: RequestContext, input: { project?: string; task?: string }): Promise<{ project: ProjectEntity; task: TaskEntity | null }>;
}

export interface ProjectService {
  list(context: RequestContext): Promise<ProjectEntity[]>;
  get(context: ProjectContext): Promise<ProjectEntity>;
  create(context: RequestContext, input: ProjectCreateInput): Promise<ProjectEntity>;
  update(context: ProjectContext, input: Partial<Pick<ProjectEntity, "name" | "description" | "repoUrl" | "color">>): Promise<ProjectEntity>;
  delete(context: ProjectContext): Promise<void>;
  reorder(context: RequestContext, projectIds: string[]): Promise<void>;
  addMember(context: ProjectContext, userId: string, role: "OWNER" | "MEMBER"): Promise<void>;
  removeMember(context: ProjectContext, userId: string): Promise<void>;
}

export interface PhaseService {
  list(context: ProjectContext): Promise<PhaseEntity[]>;
  create(context: ProjectContext, input: { number: number; goal: string; isActive: boolean }): Promise<PhaseEntity>;
  update(context: RequestContext, phaseId: string, input: Partial<Pick<PhaseEntity, "number" | "goal" | "isActive">>): Promise<PhaseEntity>;
  delete(context: RequestContext, phaseId: string): Promise<void>;
}

export interface TaskService {
  list(context: ProjectContext, filters?: TaskFilters): Promise<TaskEntity[]>;
  get(context: RequestContext, taskId: string): Promise<TaskEntity>;
  create(context: ProjectContext, input: TaskCreateInput): Promise<TaskEntity>;
  update(context: RequestContext, taskId: string, input: TaskUpdateInput): Promise<TaskEntity>;
  delete(context: RequestContext, taskId: string): Promise<void>;
  addUpdate(context: RequestContext, taskId: string, body: string): Promise<TaskUpdateEntity>;
  listUpdates(context: RequestContext, taskId: string): Promise<TaskUpdateEntity[]>;
  listTags(context: ProjectContext): Promise<Array<{ id: string; projectId: string; name: string; createdAt: string; taskCount: number }>>;
}

export interface AttachmentService {
  list(context: RequestContext, taskId: string): Promise<AttachmentEntity[]>;
  upload(context: RequestContext, taskId: string, input: { fileName: string; mimeType: string; data: string }): Promise<AttachmentEntity>;
  get(context: RequestContext, attachmentId: string): Promise<AttachmentEntity>;
  remove(context: RequestContext, attachmentId: string): Promise<void>;
}

export interface UserService {
  list(context: RequestContext): Promise<UserEntity[]>;
  updateProfile(context: RequestContext, input: { name: string; email: string }): Promise<UserEntity>;
  updateAvatar(context: RequestContext, userId: string, avatarUrl: string | null): Promise<UserEntity>;
  createAgent(context: RequestContext, input: { name: string; email?: string }): Promise<UserEntity>;
  deleteAgent(context: RequestContext, agentId: string): Promise<void>;
  listTokens(context: RequestContext, userId: string): Promise<ApiTokenEntity[]>;
  issueToken(context: RequestContext, userId: string, input: { name: string; expiresInDays: number | null }): Promise<{ token: string; prefix: string; expiresAt: string | null }>;
  revokeToken(context: RequestContext, tokenId: string): Promise<void>;
}

export interface NotificationService {
  list(context: RequestContext): Promise<NotificationEntity[]>;
  markRead(context: RequestContext, notificationId: string): Promise<NotificationEntity>;
  markAllRead(context: RequestContext): Promise<number>;
}

export interface SearchService {
  search(context: RequestContext, query: string): Promise<TaskEntity[]>;
}
