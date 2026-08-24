import type { ActivityEntity, AgentLastActiveEntity, AgentRunEntity, AgentWebhookConfiguration, ApiTokenEntity, AttachmentEntity, AutomationEntity, NotificationEntity, Page, PageRequest, PhaseEntity, ProjectEntity, ProjectPhaseMetricEntity, ReportingTaskEntity, TaskDependencyEntity, TaskEntity, TaskStatusCountEntity, TaskTagEntity, TaskUpdateEntity, UserEntity, WebhookDeliveryEntity } from "./models.js";
import type { TaskFilters } from "./services.js";

export interface UserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<(UserEntity & { passwordHash: string | null }) | null>;
  list(): Promise<UserEntity[]>;
  saveProfile(id: string, input: { name: string; email: string }): Promise<UserEntity>;
  updateAvatar(id: string, avatarUrl: string | null): Promise<UserEntity>;
  getWebhookConfiguration(id: string): Promise<AgentWebhookConfiguration | null>;
  updateWebhookConfiguration(id: string, input: { webhookUrl?: string | null; secretCiphertext?: string; secretVersion?: number }): Promise<UserEntity>;
  createAgent(input: { id: string; name: string; email: string; createdAt: string }): Promise<UserEntity>;
  deleteAgent(id: string): Promise<void>;
  hasAgentHistory(id: string): Promise<boolean>;
}

export interface ProjectRepository {
  findById(id: string): Promise<ProjectEntity | null>;
  findByKey(key: string): Promise<ProjectEntity | null>;
  listAccessible(actorId: string, isAdmin: boolean): Promise<ProjectEntity[]>;
  allocateSortOrder(): Promise<number>;
  reorder(ids: string[]): Promise<void>;
  create(input: ProjectEntity): Promise<ProjectEntity>;
  update(id: string, input: Partial<Pick<ProjectEntity, "name" | "description" | "repoUrl" | "color" | "availableStatuses" | "defaultStatus">>): Promise<ProjectEntity>;
  delete(id: string): Promise<void>;
}

export interface MembershipRepository {
  isMember(projectId: string, userId: string): Promise<boolean>;
  list(projectId: string): Promise<UserEntity[]>;
  add(projectId: string, userId: string, role: "OWNER" | "MEMBER"): Promise<void>;
  remove(projectId: string, userId: string): Promise<void>;
}

export interface PhaseRepository {
  list(projectId: string): Promise<PhaseEntity[]>;
  findById(id: string): Promise<PhaseEntity | null>;
  findActive(projectId: string): Promise<PhaseEntity | null>;
  deactivateOthers(projectId: string, phaseId?: string): Promise<void>;
  create(input: PhaseEntity): Promise<PhaseEntity>;
  update(id: string, input: Partial<Pick<PhaseEntity, "number" | "goal" | "isActive">>): Promise<PhaseEntity>;
  delete(id: string): Promise<void>;
}

export interface TaskRepository {
  findById(id: string): Promise<TaskEntity | null>;
  findByProjectNumber(projectId: string, number: number): Promise<TaskEntity | null>;
  listByProject(projectId: string, filters: TaskFilters | undefined, page: PageRequest): Promise<Page<TaskEntity>>;
  listForAssignee(assigneeId: string, status?: string): Promise<TaskEntity[]>;
  listUsedStatuses(projectId: string): Promise<TaskEntity["status"][]>;
  claimNext(projectId: string, claimantId: string, workflow: { sourceStatuses: TaskEntity["status"][]; targetStatus: TaskEntity["status"] }, options?: { phaseId?: string | null; priority?: string }): Promise<(TaskEntity & { previousStatus?: TaskEntity["status"] }) | null>;
  allocateNumber(projectId: string, status: TaskEntity["status"]): Promise<{ number: number; position: number }>;
  unassignForProjectMember(projectId: string, userId: string): Promise<void>;
  create(input: TaskEntity): Promise<TaskEntity>;
  update(id: string, input: Partial<TaskEntity>): Promise<TaskEntity>;
  delete(id: string): Promise<void>;
}

export interface TaskTagRepository {
  listForTask(taskId: string): Promise<TaskTagEntity[]>;
  listForProject(projectId: string): Promise<Array<TaskTagEntity & { taskCount: number }>>;
  replaceForTask(taskId: string, projectId: string, names: string[], createdAt: string): Promise<void>;
}

export interface TaskDependencyRepository {
  listForTask(taskId: string): Promise<TaskDependencyEntity[]>;
  replaceForTask(taskId: string, dependencyIds: string[], createdAt: string): Promise<void>;
}

export interface TaskUpdateRepository {
  listForTask(taskId: string, page: PageRequest): Promise<Page<TaskUpdateEntity>>;
  create(input: TaskUpdateEntity): Promise<TaskUpdateEntity>;
}

export interface AttachmentRepository {
  listForTask(taskId: string): Promise<AttachmentEntity[]>;
  findById(id: string): Promise<AttachmentEntity | null>;
  create(input: AttachmentEntity): Promise<AttachmentEntity>;
  delete(id: string): Promise<void>;
}

export interface AutomationRepository { listForProject(projectId: string): Promise<AutomationEntity[]>; findById(id: string): Promise<AutomationEntity | null>; create(input: AutomationEntity): Promise<AutomationEntity>; update(id: string, input: Partial<AutomationEntity>): Promise<AutomationEntity>; delete(id: string): Promise<void>; }

export interface NotificationRepository {
  notify(input: { userId: string; projectId?: string | null; taskId?: string | null; type: string; title: string; message: string }): Promise<void>;
  listForUser(userId: string, page: PageRequest): Promise<Page<NotificationEntity> & { unreadCount: number }>;
  markRead(userId: string, id: string): Promise<NotificationEntity>;
  markAllRead(userId: string): Promise<number>;
}

export interface ApiTokenRepository {
  create(input: { id: string; userId: string; name: string; prefix: string; hash: string; ciphertext: string; permissions: string[] | null; expiresAt: string | null; createdAt: string }): Promise<void>;
  listForUser(userId: string): Promise<ApiTokenEntity[]>;
  findById(id: string): Promise<(ApiTokenEntity & { userId: string; ciphertext: string | null }) | null>;
  revoke(id: string): Promise<void>;
}

export interface SearchRepository {
  searchAccessible(input: { actorId: string; isAdmin: boolean; query: string; page: PageRequest }): Promise<Page<TaskEntity>>;
}

export interface ActivityRepository {
  record(input: { projectId: string; taskId?: string | null; actorId: string; action: string; metadata?: unknown }): Promise<void>;
  list(filters: { projectId?: string; taskId?: string; actorId?: string; page: PageRequest }): Promise<Page<ActivityEntity>>;
}

export interface WebhookDeliveryRepository {
  create(input: WebhookDeliveryEntity): Promise<WebhookDeliveryEntity>;
  findById(id: string): Promise<WebhookDeliveryEntity | null>;
  list(filters: { agentId?: string; status?: WebhookDeliveryEntity["status"]; limit: number }): Promise<WebhookDeliveryEntity[]>;
  listDue(now: string, limit: number): Promise<string[]>;
  claim(id: string, now: string, lockedUntil: string): Promise<boolean>;
  markDelivered(id: string, deliveredAt: string, httpStatus: number): Promise<void>;
  markRetry(id: string, nextAttemptAt: string, lastError: string, httpStatus: number | null, updatedAt: string): Promise<void>;
  markFailed(id: string, failedAt: string, lastError: string, httpStatus: number | null): Promise<void>;
  retry(id: string, nextAttemptAt: string): Promise<boolean>;
}
export interface AgentRunRepository {
  create(input: AgentRunEntity): Promise<AgentRunEntity>;
  findById(id: string): Promise<AgentRunEntity | null>;
  listForTask(taskId: string): Promise<AgentRunEntity[]>;
  claim(id: string, owner: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  heartbeat(id: string, owner: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  complete(id: string, owner: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED", now: string, error?: string | null): Promise<boolean>;
}

export interface ReportingRepository {
  countTasksByProject(projectIds: string[]): Promise<TaskStatusCountEntity[]>;
  countNonDonePhasesByProject(projectIds: string[]): Promise<ProjectPhaseMetricEntity[]>;
  listMyOpenTasks(assigneeId: string, limit: number): Promise<ReportingTaskEntity[]>;
  listStuckTasks(projectIds: string[], updatedBefore: string, limit: number): Promise<ReportingTaskEntity[]>;
  listAgentInProgressTasks(agentIds: string[]): Promise<ReportingTaskEntity[]>;
  listAgentLastActive(agentIds: string[]): Promise<AgentLastActiveEntity[]>;
}

export interface RepositorySet {
  users: UserRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  phases: PhaseRepository;
  tasks: TaskRepository;
  tags: TaskTagRepository;
  dependencies: TaskDependencyRepository;
  updates: TaskUpdateRepository;
  attachments: AttachmentRepository;
  automations: AutomationRepository;
  notifications: NotificationRepository;
  activity: ActivityRepository;
  webhookDeliveries: WebhookDeliveryRepository;
  reporting: ReportingRepository;
  tokens: ApiTokenRepository;
  search: SearchRepository;
  runs: AgentRunRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: RepositorySet) => Promise<T>): Promise<T>;
}
