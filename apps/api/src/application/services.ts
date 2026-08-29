import type { AgentOpsEntry, DashboardSummary, WebhookDelivery, WebhookDeliveryStatus } from "@taskforge/contracts";
import type { ProjectContext, RequestContext } from "./context.js";
import type { ActivityEntity, AgentHandoffEntity, AgentLogEntity, ApiTokenEntity, AttachmentEntity, FindingDisposition, FindingSeverity, NotificationEntity, Page, PageRequest, PhaseEntity, ProjectEntity, TaskEntity, TaskFindingEntity, TaskGateEntity, TaskUpdateEntity, UserEntity } from "./models.js";

export type ProjectCreateInput = Omit<ProjectEntity, "id" | "ownerId" | "createdAt" | "updatedAt" | "sortOrder" | "availableStatuses" | "defaultStatus" | "agentWorkflow" | "hiddenEmptyStatuses" | "mergeTarget">;
type TaskInputFields = Partial<Omit<TaskEntity, "id" | "projectId" | "number" | "creatorId" | "position" | "createdAt" | "updatedAt" | "assignee" | "tags" | "dependencies">> & Pick<TaskEntity, "title">;
export type TaskCreateInput = TaskInputFields & { tags?: string[]; dependencyIds?: string[] };
export type TaskUpdateInput = Partial<TaskInputFields> & { tags?: string[]; dependencyIds?: string[]; runId?: string | null };
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
  update(context: ProjectContext, input: Partial<Pick<ProjectEntity, "name" | "description" | "repoUrl" | "localRepoPath" | "color" | "availableStatuses" | "defaultStatus" | "agentWorkflow" | "hiddenEmptyStatuses" | "mergeTarget">>): Promise<ProjectEntity>;
  enableAgentWorkflow(context: ProjectContext): Promise<ProjectEntity>;
  delete(context: ProjectContext): Promise<void>;
  reorder(context: RequestContext, projectIds: string[]): Promise<void>;
  addMember(context: ProjectContext, userId: string, role: "OWNER" | "MEMBER"): Promise<void>;
  removeMember(context: ProjectContext, userId: string): Promise<void>;
}

export interface PhaseService {
  list(context: ProjectContext): Promise<PhaseEntity[]>;
  create(context: ProjectContext, input: { number: number; goal: string; isActive: boolean }): Promise<PhaseEntity>;
  update(context: RequestContext, phaseId: string, input: Partial<Pick<PhaseEntity, "number" | "goal" | "isActive">>): Promise<PhaseEntity>;
  delete(context: RequestContext, phaseId: string, options?: { taskAction?: "move" | "delete"; targetPhaseId?: string }): Promise<void>;
  ensureBranch(context: ProjectContext, phaseId: string): Promise<{ phaseId: string; branchName: string }>;
  mergeToMain(context: ProjectContext, phaseId: string): Promise<{ phaseId: string; branchName: string; target: "main" }>;
}

export interface TaskService {
  list(context: ProjectContext, filters: TaskFilters | undefined, page: PageRequest): Promise<Page<TaskEntity>>;
  get(context: RequestContext, taskId: string): Promise<TaskEntity>;
  create(context: ProjectContext, input: TaskCreateInput): Promise<TaskEntity>;
  update(context: RequestContext, taskId: string, input: TaskUpdateInput): Promise<TaskEntity>;
  delete(context: RequestContext, taskId: string): Promise<void>;
  addUpdate(context: RequestContext, taskId: string, body: string): Promise<TaskUpdateEntity>;
  listUpdates(context: RequestContext, taskId: string, page: PageRequest): Promise<Page<TaskUpdateEntity>>;
  listTags(context: ProjectContext): Promise<Array<{ id: string; projectId: string; name: string; createdAt: string; taskCount: number }>>;
  claimTask(context: ProjectContext, options?: { phaseId?: string | null; priority?: string; runId?: string | null }): Promise<TaskEntity>;
}
export interface AgentLogService {
  list(context: RequestContext, taskId: string, page: PageRequest): Promise<Page<AgentLogEntity>>;
  append(context: RequestContext, taskId: string, input: Omit<AgentLogEntity, "id" | "taskId" | "createdAt">): Promise<AgentLogEntity | null>;
}
export interface AgentHandoffService { get(context: RequestContext, runId: string): Promise<AgentHandoffEntity | null>; save(context: RequestContext, runId: string, input: Omit<AgentHandoffEntity, "runId" | "taskId" | "createdAt" | "updatedAt">): Promise<AgentHandoffEntity>; validate(context: RequestContext, runId: string): Promise<AgentHandoffEntity>; }
export interface TaskGateService {
  get(context: RequestContext, taskId: string): Promise<TaskGateEntity | null>;
  record(context: RequestContext, taskId: string, input: Pick<TaskGateEntity, "headSha" | "requiredChecks" | "checks">): Promise<TaskGateEntity>;
  approve(context: RequestContext, taskId: string, headSha: string): Promise<TaskGateEntity>;
  merge(context: RequestContext, taskId: string, headSha: string): Promise<TaskGateEntity>;
}
export interface TaskFindingService {
  list(context: RequestContext, taskId: string): Promise<TaskFindingEntity[]>;
  create(context: RequestContext, taskId: string, input: { severity: FindingSeverity; title: string; body: string; filePath?: string | null; lineNumber?: number | null; runId?: string | null }): Promise<TaskFindingEntity>;
  dispose(context: RequestContext, findingId: string, input: { disposition: FindingDisposition; reason?: string | null; decisionOwnerId?: string | null; dueAt?: string | null }): Promise<TaskFindingEntity>;
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
  updateAgentWebhook(context: RequestContext, agentId: string, webhookUrl: string | null): Promise<{ user: UserEntity; webhookSecret?: string }>;
  rotateAgentWebhookSecret(context: RequestContext, agentId: string): Promise<{ user: UserEntity; webhookSecret: string }>;
  createAgent(context: RequestContext, input: { name: string; email?: string }): Promise<UserEntity>;
  deleteAgent(context: RequestContext, agentId: string): Promise<void>;
  listTokens(context: RequestContext, userId: string): Promise<ApiTokenEntity[]>;
  issueToken(context: RequestContext, userId: string, input: { name: string; expiresInDays: number | null; permissions?: string[] | null }): Promise<{ token: string; prefix: string; expiresAt: string | null }>;
  revealToken(context: RequestContext, userId: string, tokenId: string): Promise<{ token: string }>;
  revokeToken(context: RequestContext, tokenId: string): Promise<void>;
  agentOperations(context: RequestContext): Promise<AgentOpsEntry[]>;
}

export interface WebhookDeliveryService {
  list(context: RequestContext, filters: { agentId?: string; status?: WebhookDeliveryStatus; limit: number }): Promise<WebhookDelivery[]>;
  retry(context: RequestContext, deliveryId: string): Promise<WebhookDelivery>;
  metrics(context: RequestContext): Promise<Record<WebhookDeliveryStatus, number>>;
  purge(context: RequestContext, before: string, limit: number): Promise<number>;
}

export interface NotificationService {
  list(context: RequestContext, page: PageRequest): Promise<Page<NotificationEntity> & { unreadCount: number }>;
  markRead(context: RequestContext, notificationId: string): Promise<NotificationEntity>;
  markAllRead(context: RequestContext): Promise<number>;
}

export interface SearchService {
  search(context: RequestContext, query: string, page: PageRequest): Promise<Page<TaskEntity>>;
}

export interface ActivityService {
  list(context: RequestContext, filters: { projectId?: string; taskId?: string; actorId?: string; page: PageRequest }): Promise<Page<ActivityEntity>>;
}

export interface DashboardService {
  summary(context: RequestContext): Promise<DashboardSummary>;
}
