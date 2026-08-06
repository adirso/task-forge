import type { ApiTokenEntity, NotificationEntity, PhaseEntity, ProjectEntity, TaskDependencyEntity, TaskEntity, TaskTagEntity, TaskUpdateEntity, UserEntity } from "./models.js";
import type { TaskFilters } from "./services.js";

export interface UserRepository {
  findById(id: string): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<(UserEntity & { passwordHash: string | null }) | null>;
  list(): Promise<UserEntity[]>;
  saveProfile(id: string, input: { name: string; email: string }): Promise<UserEntity>;
  createAgent(input: { id: string; name: string; email: string; createdAt: string }): Promise<UserEntity>;
  deleteAgent(id: string): Promise<void>;
}

export interface ProjectRepository {
  findById(id: string): Promise<ProjectEntity | null>;
  findByKey(key: string): Promise<ProjectEntity | null>;
  listAccessible(actorId: string, isAdmin: boolean): Promise<ProjectEntity[]>;
  create(input: ProjectEntity): Promise<ProjectEntity>;
  update(id: string, input: Partial<Pick<ProjectEntity, "name" | "description" | "repoUrl" | "color">>): Promise<ProjectEntity>;
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
  create(input: PhaseEntity): Promise<PhaseEntity>;
  update(id: string, input: Partial<Pick<PhaseEntity, "number" | "goal" | "isActive">>): Promise<PhaseEntity>;
  delete(id: string): Promise<void>;
}

export interface TaskRepository {
  findById(id: string): Promise<TaskEntity | null>;
  listByProject(projectId: string, filters?: TaskFilters): Promise<TaskEntity[]>;
  allocateNumber(projectId: string, status: TaskEntity["status"]): Promise<{ number: number; position: number }>;
  create(input: TaskEntity): Promise<TaskEntity>;
  update(id: string, input: Partial<TaskEntity>): Promise<TaskEntity>;
  delete(id: string): Promise<void>;
}

export interface TaskTagRepository {
  listForTask(taskId: string): Promise<TaskTagEntity[]>;
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

export interface NotificationRepository {
  notify(input: { userId: string; projectId?: string | null; taskId?: string | null; type: string; title: string; message: string }): Promise<void>;
  listForUser(userId: string): Promise<NotificationEntity[]>;
  markRead(userId: string, id: string): Promise<NotificationEntity>;
  markAllRead(userId: string): Promise<number>;
}

export interface ApiTokenRepository {
  create(input: { id: string; userId: string; name: string; prefix: string; hash: string; expiresAt: string | null; createdAt: string }): Promise<void>;
  listForUser(userId: string): Promise<ApiTokenEntity[]>;
  revoke(id: string): Promise<void>;
}

export interface SearchRepository {
  searchAccessible(input: { actorId: string; isAdmin: boolean; query: string }): Promise<TaskEntity[]>;
}

export interface ActivityRepository {
  record(input: { projectId: string; taskId?: string | null; actorId: string; action: string; metadata?: unknown }): Promise<void>;
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
  notifications: NotificationRepository;
  activity: ActivityRepository;
  tokens: ApiTokenRepository;
  search: SearchRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: RepositorySet) => Promise<T>): Promise<T>;
}
