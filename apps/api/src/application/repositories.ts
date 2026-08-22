import type { ActivityEntity, AgentLastActiveEntity, ApiTokenEntity, AttachmentEntity, AutomationEntity, NotificationEntity, PhaseEntity, ProjectEntity, ReportingTaskEntity, TaskDependencyEntity, TaskEntity, TaskStatusCountEntity, TaskTagEntity, TaskUpdateEntity, UserEntity } from "./models.js";
import type { TaskFilters } from "./services.js";

export interface UserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<(UserEntity & { passwordHash: string | null }) | null>;
  list(): Promise<UserEntity[]>;
  saveProfile(id: string, input: { name: string; email: string }): Promise<UserEntity>;
  updateAvatar(id: string, avatarUrl: string | null): Promise<UserEntity>;
  updateWebhookUrl(id: string, webhookUrl: string | null): Promise<UserEntity>;
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
  listByProject(projectId: string, filters?: TaskFilters): Promise<TaskEntity[]>;
  listForAssignee(assigneeId: string, status?: string): Promise<TaskEntity[]>;
  listUsedStatuses(projectId: string): Promise<TaskEntity["status"][]>;
  claimNext(projectId: string, claimantId: string, options?: { phaseId?: string | null; priority?: string }): Promise<TaskEntity | null>;
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
  listForTask(taskId: string): Promise<TaskUpdateEntity[]>;
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
  listForUser(userId: string): Promise<NotificationEntity[]>;
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
  searchAccessible(input: { actorId: string; isAdmin: boolean; query: string }): Promise<TaskEntity[]>;
}

export interface ActivityRepository {
  record(input: { projectId: string; taskId?: string | null; actorId: string; action: string; metadata?: unknown }): Promise<void>;
  list(filters: { projectId?: string; taskId?: string; actorId?: string; limit?: number }): Promise<ActivityEntity[]>;
}

export interface ReportingRepository {
  countTasksByProject(projectIds: string[]): Promise<TaskStatusCountEntity[]>;
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
  reporting: ReportingRepository;
  tokens: ApiTokenRepository;
  search: SearchRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: RepositorySet) => Promise<T>): Promise<T>;
}
