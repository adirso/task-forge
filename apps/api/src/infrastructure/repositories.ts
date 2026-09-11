import { randomUUID } from "node:crypto";
import { DEFAULT_DEPENDENCY_RESOLUTION_STATUSES, DEFAULT_PROJECT_REVIEW_POLICY, DEFAULT_PROJECT_STATUSES, TASK_STATUSES, agentBudgetLimitsSchema, agentCapabilityProfileSchema, agentWorkflowSchema, dependencyResolutionStatusesSchema, projectReviewPolicySchema, type AgentArtifactMetadata, type AgentArtifactType, type AgentUsageBreakdown, type AgentUsageReport, type AgentUsageTotals, type TaskStatus } from "@taskforge/contracts";
import type { ActivityEntity, AgentArtifactEntity, AgentBudgetEntity, AgentContextPackEntity, AgentHandoffEntity, AgentLastActiveEntity, AgentLogEntity, AgentPlanEntity, AgentRunCredentialEntity, AgentRunEntity, AgentUsageEventEntity, ApiTokenEntity, AttachmentEntity, AutomationEntity, DeliveryMonitorHealthEntity, NotificationEntity, PageRequest, PhaseEntity, ProjectEntity, ReportingTaskEntity, TaskDependencyEntity, TaskEntity, TaskFindingEntity, TaskGateEntity, TaskStatusCountEntity, TaskTagEntity, TaskUpdateEntity, UserEntity, WebhookDeliveryEntity } from "../application/models.js";
import type { AgentArtifactRepository, AgentBudgetRepository, AgentContextPackRepository, AgentHandoffRepository, AgentLogRepository, AgentPlanRepository, AgentRunRepository, AgentUsageRepository, ApiTokenRepository, AttachmentRepository, ActivityRepository, AutomationRepository, DeliveryMonitorRepository, MembershipRepository, NotificationRepository, PhaseRepository, ProjectRepository, ReportingRepository, RepositorySet, SearchRepository, TaskDependencyRepository, TaskFindingRepository, TaskGateRepository, TaskRepository, TaskTagRepository, TaskUpdateRepository, UserRepository, WebhookDeliveryRepository } from "../application/repositories.js";
import type { TaskFilters } from "../application/services.js";
import { decodeCursor, toPage } from "./pagination.js";

export interface DatabasePort {
  readonly dialect: "sqlite" | "mysql";
  prepare(sql: string): {
    get<T extends Record<string, unknown> = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
    all<T extends Record<string, unknown> = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
    run(...params: unknown[]): Promise<{ changes: number }>;
  };
  transaction<T>(callback: () => Promise<T>): () => Promise<T>;
}

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value);
const nullableText = (value: unknown) => (value == null ? null : String(value));
const date = (value: unknown) => String(value);
const queryLimit = (value: number) => Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));

function toUser(row: Row): UserEntity {
  let capabilityProfile: UserEntity["capabilityProfile"] = null;
  let capabilityProfileError: string | null = null;
  try {
    const parsed = agentCapabilityProfileSchema.safeParse(typeof row.capability_profile === "string" ? JSON.parse(row.capability_profile) : row.capability_profile);
    if (parsed.success) capabilityProfile = parsed.data;
    else if (row.capability_profile != null) capabilityProfileError = "Stored capability profile is invalid; an administrator must save it again.";
  } catch { capabilityProfileError = "Stored capability profile is invalid; an administrator must save it again."; }
  return { id: text(row.id), email: nullableText(row.email), name: text(row.name), kind: row.kind as UserEntity["kind"], role: row.role as UserEntity["role"], avatarUrl: nullableText(row.avatar_url), webhookUrl: nullableText(row.webhook_url), webhookSecretConfigured: Boolean(row.webhook_secret_ciphertext), capabilityProfile, capabilityProfileError, createdAt: date(row.created_at) };
}

function toWebhookDelivery(row: Row): WebhookDeliveryEntity {
  return {
    id: text(row.id), agentId: text(row.agent_id), taskId: nullableText(row.task_id), eventType: row.event_type as WebhookDeliveryEntity["eventType"],
    payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload), status: row.status as WebhookDeliveryEntity["status"], attemptCount: Number(row.attempt_count), nextAttemptAt: date(row.next_attempt_at),
    lockedUntil: nullableText(row.locked_until), lastAttemptAt: nullableText(row.last_attempt_at), deliveredAt: nullableText(row.delivered_at), failedAt: nullableText(row.failed_at),
    lastError: nullableText(row.last_error), httpStatus: row.http_status == null ? null : Number(row.http_status), createdAt: date(row.created_at), updatedAt: date(row.updated_at),
    ...(row.agent_name !== undefined ? { agentName: text(row.agent_name) } : {}), ...(row.task_number !== undefined ? { taskNumber: row.task_number == null ? null : Number(row.task_number) } : {}),
    ...(row.project_key !== undefined ? { projectKey: nullableText(row.project_key) } : {}),
  };
}

function configuredStatuses(value: unknown): TaskStatus[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (Array.isArray(parsed)) {
      const selected = TASK_STATUSES.filter((status) => parsed.includes(status));
      if (selected.length) return selected;
    }
  } catch { /* Legacy rows use the complete status set. */ }
  return [...DEFAULT_PROJECT_STATUSES];
}

function configuredDependencyResolutionStatuses(value: unknown) {
  try {
    const parsed = dependencyResolutionStatusesSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    if (parsed.success) return parsed.data;
  } catch { /* Legacy and malformed rows use the safe default. */ }
  return [...DEFAULT_DEPENDENCY_RESOLUTION_STATUSES];
}

function configuredReviewPolicy(value: unknown) {
  try {
    const parsed = projectReviewPolicySchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    if (parsed.success) return parsed.data;
  } catch { /* Legacy projects keep independent review disabled until configured. */ }
  return { ...DEFAULT_PROJECT_REVIEW_POLICY, requireIndependentReview: false, allowedReviewerAgentIds: [] };
}

function toProject(row: Row): ProjectEntity {
  const availableStatuses = configuredStatuses(row.available_statuses);
  const configuredDefault = String(row.default_status ?? "TODO") as TaskStatus;
  const defaultStatus = availableStatuses.includes(configuredDefault) ? configuredDefault : availableStatuses[0]!;
  let agentWorkflow: ProjectEntity["agentWorkflow"] = null;
  if (row.agent_workflow) {
    try { const parsed = agentWorkflowSchema.safeParse(typeof row.agent_workflow === "string" ? JSON.parse(row.agent_workflow) : row.agent_workflow); if (parsed.success) agentWorkflow = parsed.data; } catch { /* Invalid configuration remains disabled. */ }
  }
  let hiddenEmptyStatuses = availableStatuses;
  try { const parsed = JSON.parse(String(row.hidden_empty_statuses ?? "")); if (Array.isArray(parsed)) hiddenEmptyStatuses = availableStatuses.filter((status) => parsed.includes(status)); } catch { /* Migration default preserves existing hide-empty behavior. */ }
  return { id: text(row.id), key: text(row.key), name: text(row.name), description: text(row.description), repoUrl: nullableText(row.repo_url), localRepoPath: nullableText(row.local_repo_path), color: text(row.color), sortOrder: Number(row.sort_order ?? 0), availableStatuses, defaultStatus, agentWorkflow, hiddenEmptyStatuses, mergeTarget: row.merge_target === "phase" ? "phase" : "main", dependencyResolutionStatuses: configuredDependencyResolutionStatuses(row.dependency_resolution_statuses), reviewPolicy: configuredReviewPolicy(row.review_policy), ownerId: text(row.owner_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}) };
}

function toPhase(row: Row): PhaseEntity {
  return { id: text(row.id), projectId: text(row.project_id), number: Number(row.number), goal: text(row.goal), isActive: Boolean(row.is_active), createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...(row.branch_name != null ? { branchName: String(row.branch_name) } : {}), ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}), ...(row.non_done_task_count !== undefined ? { nonDoneTaskCount: Number(row.non_done_task_count) } : {}), ...(row.completed_task_count !== undefined ? { completedTaskCount: Number(row.completed_task_count) } : {}), ...(row.cancelled_task_count !== undefined ? { cancelledTaskCount: Number(row.cancelled_task_count) } : {}) };
}

function toTask(row: Row): TaskEntity {
  return {
    id: text(row.id), projectId: text(row.project_id), number: Number(row.number), title: text(row.title), description: text(row.description),
    definitionOfDone: text(row.definition_of_done), status: row.status as TaskEntity["status"], priority: row.priority as TaskEntity["priority"],
    type: (row.type as TaskEntity["type"]) ?? "FEATURE",
    assigneeId: nullableText(row.assignee_id), creatorId: text(row.creator_id), parentId: nullableText(row.parent_id), branch: nullableText(row.branch),
    dueDate: nullableText(row.due_date), estimatePoints: row.estimate_points == null ? null : Number(row.estimate_points), phaseId: nullableText(row.phase_id),
    pullRequestUrl: nullableText(row.pull_request_url), pullRequestTitle: nullableText(row.pull_request_title), pullRequestState: (row.pull_request_state as TaskEntity["pullRequestState"]) ?? null,
    position: Number(row.position), createdAt: date(row.created_at), updatedAt: date(row.updated_at),
  };
}

const terminalStatuses = new Set(["DONE", "CANCELLED"]);

function toReportingTask(row: Row): ReportingTaskEntity {
  return {
    id: text(row.id),
    number: Number(row.number),
    title: text(row.title),
    projectId: text(row.project_id),
    projectKey: text(row.project_key),
    projectName: text(row.project_name),
    status: row.status as TaskStatus,
    assigneeId: nullableText(row.assignee_id),
    assigneeName: nullableText(row.assignee_name),
    updatedAt: date(row.updated_at),
  };
}

function toTag(row: Row): TaskTagEntity {
  return { id: text(row.id), projectId: text(row.project_id), name: text(row.name), createdAt: date(row.created_at) };
}

function toDependency(row: Row): TaskDependencyEntity {
  const status = row.status as TaskDependencyEntity["status"];
  return { taskId: text(row.task_id), dependsOnTaskId: text(row.depends_on_task_id), projectId: text(row.project_id), projectKey: nullableText(row.project_key) ?? undefined, number: Number(row.number), title: text(row.title), status, isBlocking: !configuredDependencyResolutionStatuses(row.dependency_resolution_statuses).includes(status as "DONE" | "CANCELLED") };
}

function toUpdate(row: Row): TaskUpdateEntity {
  return { id: text(row.id), taskId: text(row.task_id), authorId: text(row.author_id), body: text(row.body), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}

function toHydratedUpdate(row: Row): TaskUpdateEntity {
  return { ...toUpdate(row), author: { id: text(row.author_user_id), email: nullableText(row.author_email), name: text(row.author_name), kind: row.author_kind as UserEntity["kind"], role: row.author_role as UserEntity["role"], avatarUrl: nullableText(row.author_avatar_url), createdAt: date(row.author_created_at) } };
}

function toAgentLog(row: Row): AgentLogEntity {
  return { id: text(row.id), taskId: text(row.task_id), runId: nullableText(row.run_id), provider: text(row.provider), stream: row.stream as AgentLogEntity["stream"], category: row.category as AgentLogEntity["category"], sequence: Number(row.sequence), eventId: nullableText(row.event_id), content: text(row.content), createdAt: date(row.created_at) };
}

function toAttachment(row: Row): AttachmentEntity {
  return { id: text(row.id), taskId: text(row.task_id), fileName: text(row.file_name), mimeType: text(row.mime_type), size: Number(row.file_size), storageKey: text(row.storage_key), uploadedById: text(row.uploaded_by_id), createdAt: date(row.created_at) };
}

function toNotification(row: Row): NotificationEntity {
  return { id: text(row.id), userId: text(row.user_id), projectId: nullableText(row.project_id), taskId: nullableText(row.task_id), type: text(row.type), title: text(row.title), message: text(row.message), readAt: nullableText(row.read_at), createdAt: date(row.created_at), projectName: nullableText(row.project_name), projectKey: nullableText(row.project_key), taskNumber: row.task_number == null ? null : Number(row.task_number) };
}

function toAutomation(row: Row): AutomationEntity {
  const parse = (value: unknown) => { try { return JSON.parse(String(value ?? "[]")); } catch { return []; } };
  return { id: text(row.id), projectId: text(row.project_id), name: text(row.name), enabled: Boolean(row.enabled), trigger: row.trigger as AutomationEntity["trigger"], actorType: row.actor_type as AutomationEntity["actorType"], actorId: nullableText(row.actor_id), service: nullableText(row.service), conditions: parse(row.conditions), actions: parse(row.actions), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}

async function hydrateTasks(db: DatabasePort, tasks: TaskEntity[]): Promise<TaskEntity[]> {
  if (!tasks.length) return [];
  const ids = tasks.map((task) => task.id);
  const placeholders = ids.map(() => "?").join(",");
  const assigneeIds = [...new Set(tasks.map((task) => task.assigneeId).filter((id): id is string => Boolean(id)))];
  const phaseIds = [...new Set(tasks.map((task) => task.phaseId).filter((id): id is string => Boolean(id)))];
  const [tagRows, dependencyRows, attachmentRows, assigneeRows, phaseRows, durationRows] = await Promise.all([
    db.prepare(`SELECT tg.*, tt.task_id AS hydrated_task_id FROM tags tg JOIN task_tags tt ON tt.tag_id = tg.id WHERE tt.task_id IN (${placeholders}) ORDER BY tg.name`).all(...ids),
    db.prepare(`SELECT td.task_id, td.depends_on_task_id, dep.project_id, p.\`key\` AS project_key, p.dependency_resolution_statuses, dep.number, dep.title, dep.status FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on_task_id JOIN projects p ON p.id = dep.project_id WHERE td.task_id IN (${placeholders}) ORDER BY dep.number`).all(...ids),
    db.prepare(`SELECT a.*, u.id AS uploaded_user_id, u.email AS uploaded_email, u.name AS uploaded_name, u.kind AS uploaded_kind, u.role AS uploaded_role, u.avatar_url AS uploaded_avatar_url, u.created_at AS uploaded_created_at FROM task_attachments a JOIN users u ON u.id = a.uploaded_by_id WHERE a.task_id IN (${placeholders}) ORDER BY a.created_at DESC, a.id`).all(...ids),
    assigneeIds.length ? db.prepare(`SELECT * FROM users WHERE id IN (${assigneeIds.map(() => "?").join(",")})`).all(...assigneeIds) : Promise.resolve([]),
    phaseIds.length ? db.prepare(`SELECT * FROM phases WHERE id IN (${phaseIds.map(() => "?").join(",")})`).all(...phaseIds) : Promise.resolve([]),
    db.prepare(`SELECT task_id, status, entered_at, exited_at, duration_seconds FROM task_status_history WHERE task_id IN (${placeholders}) ORDER BY entered_at, id`).all(...ids),
  ]);
  const grouped = <T>(rows: T[], key: (row: T) => string) => {
    const result = new Map<string, T[]>();
    for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
    return result;
  };
  const tags = grouped(tagRows, (row) => text(row.hydrated_task_id));
  const dependencies = grouped(dependencyRows, (row) => text(row.task_id));
  const attachments = grouped(attachmentRows, (row) => text(row.task_id));
  const assignees = new Map(assigneeRows.map((row) => [text(row.id), toUser(row)]));
  const phases = new Map(phaseRows.map((row) => [text(row.id), toPhase(row)]));
  const durations = new Map<string, Partial<Record<TaskStatus, number>>>();
  const durationExcludedStatuses = new Set(["BACKLOG", "TODO"]);
  for (const row of durationRows) {
    const status = text(row.status) as TaskStatus;
    if (terminalStatuses.has(status) || durationExcludedStatuses.has(status)) continue;
    const stored = Number(row.duration_seconds ?? 0);
    const live = row.exited_at == null ? Math.max(0, (Date.now() - Date.parse(date(row.entered_at))) / 1000) : 0;
    const current = durations.get(text(row.task_id)) ?? {};
    current[status] = (current[status] ?? 0) + stored + live;
    durations.set(text(row.task_id), current);
  }
  return tasks.map((task) => {
    const taskDependencies = (dependencies.get(task.id) ?? []).map(toDependency);
    const blockers = taskDependencies.filter((dependency) => dependency.isBlocking);
    return {
      ...task,
      tags: (tags.get(task.id) ?? []).map(toTag),
      dependencies: taskDependencies,
      blockedReason: blockers.length ? `Waiting for dependencies: ${blockers.map((dependency) => `${dependency.projectKey}-${dependency.number} (${dependency.status})`).join(", ")}` : null,
      attachments: (attachments.get(task.id) ?? []).map((row) => ({ ...toAttachment(row), uploadedBy: { id: text(row.uploaded_user_id), email: nullableText(row.uploaded_email), name: text(row.uploaded_name), kind: row.uploaded_kind as UserEntity["kind"], role: row.uploaded_role as UserEntity["role"], avatarUrl: nullableText(row.uploaded_avatar_url), createdAt: date(row.uploaded_created_at) } })),
      assignee: task.assigneeId ? assignees.get(task.assigneeId) ?? null : null,
      phase: task.phaseId ? phases.get(task.phaseId) ?? null : null,
      ...(durations.has(task.id) ? { statusDurations: durations.get(task.id) } : {}),
    };
  });
}

function toToken(row: Row): ApiTokenEntity {
  const ciphertext = nullableText(row.token_ciphertext ?? row.ciphertext);
  let permissions: string[] | null = null;
  if (row.permissions) { try { permissions = JSON.parse(String(row.permissions)); } catch { permissions = null; } }
  return { id: text(row.id), userId: text(row.user_id), name: text(row.name), prefix: text(row.token_prefix ?? row.prefix), expiresAt: nullableText(row.expires_at ?? row.expiresAt), lastUsedAt: nullableText(row.last_used_at ?? row.lastUsedAt), revokedAt: nullableText(row.revoked_at ?? row.revokedAt), createdAt: date(row.created_at ?? row.createdAt), revealable: Boolean(ciphertext), ciphertext, permissions };
}

function toRunCredential(row: Row): AgentRunCredentialEntity {
  let permissions: string[] = [];
  try { permissions = JSON.parse(String(row.permissions ?? "[]")); } catch { permissions = []; }
  return {
    runId: text(row.run_id), taskId: text(row.task_id), projectId: text(row.project_id), userId: text(row.user_id),
    runAttempt: Number(row.run_attempt), prefix: text(row.token_prefix), hash: text(row.token_hash),
    ciphertext: text(row.token_ciphertext), permissions, expiresAt: date(row.expires_at),
    lastUsedAt: nullableText(row.last_used_at), revokedAt: nullableText(row.revoked_at),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at),
  };
}

function createUserRepository(db: DatabasePort): UserRepository {
  return {
    async findById(id) { const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); return row ? toUser(row) : null; },
    async findByEmail(email) { const row = await db.prepare("SELECT * FROM users WHERE email = ? AND kind = 'HUMAN'").get(email.toLowerCase()); return row ? { ...toUser(row), passwordHash: nullableText(row.password_hash) } : null; },
    async list() { return (await db.prepare("SELECT * FROM users ORDER BY kind, name").all()).map(toUser); },
    async saveProfile(id, input) { await db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(input.name, input.email.toLowerCase(), id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after update"); return toUser(row); },
    async updateAvatar(id, avatarUrl) { await db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after avatar update"); return toUser(row); },
    async updateCapabilityProfile(id, profile) { await db.prepare("UPDATE users SET capability_profile = ? WHERE id = ?").run(JSON.stringify(profile), id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("Agent not found after capability update"); return toUser(row); },
    async getWebhookConfiguration(id) { const row = await db.prepare("SELECT webhook_url, webhook_secret_ciphertext, webhook_secret_version FROM users WHERE id = ?").get(id); return row ? { webhookUrl: nullableText(row.webhook_url), secretCiphertext: nullableText(row.webhook_secret_ciphertext), secretVersion: Number(row.webhook_secret_version ?? 0) } : null; },
    async updateWebhookConfiguration(id, input) { const fields: string[] = []; const values: unknown[] = []; if ("webhookUrl" in input) { fields.push("webhook_url = ?"); values.push(input.webhookUrl ?? null); } if (input.secretCiphertext !== undefined) { fields.push("webhook_secret_ciphertext = ?"); values.push(input.secretCiphertext); } if (input.secretVersion !== undefined) { fields.push("webhook_secret_version = ?"); values.push(input.secretVersion); } if (fields.length) await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values, id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after webhook configuration update"); return toUser(row); },
    async createAgent(input) { await db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)").run(input.id, input.email.toLowerCase(), input.name, input.createdAt); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(input.id); if (!row) throw new Error("Agent not found after create"); return toUser(row); },
    async hasAgentHistory(id) { const row = await db.prepare("SELECT (SELECT COUNT(*) FROM projects WHERE owner_id = ?) + (SELECT COUNT(*) FROM tasks WHERE creator_id = ?) + (SELECT COUNT(*) FROM task_updates WHERE author_id = ?) + (SELECT COUNT(*) FROM activity WHERE actor_id = ?) AS total").get(id, id, id, id) as { total: number }; return Number(row.total) > 0; },
    async deleteAgent(id) { await db.prepare("DELETE FROM users WHERE id = ?").run(id); },
  };
}

function createProjectRepository(db: DatabasePort): ProjectRepository {
  return {
    async findById(id) { const row = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id); return row ? toProject(row) : null; },
    async findByKey(key) { const row = await db.prepare("SELECT * FROM projects WHERE `key` = ?").get(key); return row ? toProject(row) : null; },
    async listAccessible(actorId, isAdmin) { const rows = await db.prepare(`SELECT p.*, COUNT(t.id) AS task_count FROM projects p LEFT JOIN tasks t ON t.project_id = p.id WHERE ? = 1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) GROUP BY p.id ORDER BY p.sort_order ASC, p.created_at DESC`).all(isAdmin ? 1 : 0, actorId); return rows.map(toProject); },
    async allocateSortOrder() { const row = await db.prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next_order FROM projects").get(); return Number(row?.next_order ?? -1); },
    async reorder(ids) { for (const [index, id] of ids.entries()) await db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?").run(index, id); },
    async create(input) { await db.prepare("INSERT INTO projects (id, `key`, name, description, repo_url, local_repo_path, color, sort_order, available_statuses, default_status, agent_workflow, hidden_empty_statuses, merge_target, dependency_resolution_statuses, review_policy, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.key, input.name, input.description, input.repoUrl, input.localRepoPath, input.color, input.sortOrder, JSON.stringify(input.availableStatuses), input.defaultStatus, input.agentWorkflow ? JSON.stringify(input.agentWorkflow) : null, JSON.stringify(input.hiddenEmptyStatuses), input.mergeTarget, JSON.stringify(input.dependencyResolutionStatuses), JSON.stringify(input.reviewPolicy), input.ownerId, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const fields: string[] = []; const values: unknown[] = []; const columns: Record<string, string> = { name: "name", description: "description", repoUrl: "repo_url", localRepoPath: "local_repo_path", color: "color", availableStatuses: "available_statuses", defaultStatus: "default_status", agentWorkflow: "agent_workflow", hiddenEmptyStatuses: "hidden_empty_statuses", mergeTarget: "merge_target", dependencyResolutionStatuses: "dependency_resolution_statuses", reviewPolicy: "review_policy" }; for (const [key, column] of Object.entries(columns)) if (key in input) { fields.push(`${column} = ?`); const value = input[key as keyof typeof input]; values.push(["availableStatuses", "agentWorkflow", "hiddenEmptyStatuses", "dependencyResolutionStatuses", "reviewPolicy"].includes(key) ? (value ? JSON.stringify(value) : null) : value ?? null); } if (fields.length) { fields.push("updated_at = ?"); values.push(new Date().toISOString()); await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values, id); } const row = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id); if (!row) throw new Error("Project not found after update"); return toProject(row); },
    async delete(id) { await db.prepare("DELETE FROM projects WHERE id = ?").run(id); },
  };
}

function createMembershipRepository(db: DatabasePort): MembershipRepository {
  return {
    async isMember(projectId, userId) { return Boolean(await db.prepare("SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?").get(projectId, userId)); },
    async list(projectId) { return (await db.prepare("SELECT u.* FROM users u JOIN project_members pm ON pm.user_id = u.id WHERE pm.project_id = ? ORDER BY u.kind, u.name").all(projectId)).map(toUser); },
    async add(projectId, userId, role) { await db.prepare("INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run(projectId, userId, role, new Date().toISOString()); },
    async remove(projectId, userId) { await db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(projectId, userId); },
  };
}

function createPhaseRepository(db: DatabasePort): PhaseRepository {
  return {
    async list(projectId) { return (await db.prepare("SELECT p.*, COUNT(t.id) AS task_count, SUM(CASE WHEN t.status NOT IN ('DONE', 'CANCELLED') THEN 1 ELSE 0 END) AS non_done_task_count, SUM(CASE WHEN t.status = 'DONE' THEN 1 ELSE 0 END) AS completed_task_count, SUM(CASE WHEN t.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_task_count FROM phases p LEFT JOIN tasks t ON t.phase_id = p.id WHERE p.project_id = ? GROUP BY p.id ORDER BY p.number DESC").all(projectId)).map(toPhase); },
    async findById(id) { const row = await db.prepare("SELECT * FROM phases WHERE id = ?").get(id); return row ? toPhase(row) : null; },
    async findActive(projectId) { const row = await db.prepare("SELECT * FROM phases WHERE project_id = ? AND is_active = 1").get(projectId); return row ? toPhase(row) : null; },
    async deactivateOthers(projectId, phaseId) { await db.prepare("UPDATE phases SET is_active = 0, updated_at = ? WHERE project_id = ? AND (? IS NULL OR id != ?)").run(new Date().toISOString(), projectId, phaseId ?? null, phaseId ?? null); },
    async create(input) { await db.prepare("INSERT INTO phases (id, project_id, number, goal, is_active, branch_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.projectId, input.number, input.goal, input.isActive ? 1 : 0, input.branchName ?? null, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const fields: string[] = []; const values: unknown[] = []; if (input.number !== undefined) { fields.push("number = ?"); values.push(input.number); } if (input.goal !== undefined) { fields.push("goal = ?"); values.push(input.goal); } if (input.isActive !== undefined) { fields.push("is_active = ?"); values.push(input.isActive ? 1 : 0); } if (input.branchName !== undefined) { fields.push("branch_name = ?"); values.push(input.branchName); } fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE phases SET ${fields.join(", ")} WHERE id = ?`).run(...values); const row = await db.prepare("SELECT * FROM phases WHERE id = ?").get(id); if (!row) throw new Error("Phase not found after update"); return toPhase(row); },
    async delete(id) { await db.prepare("DELETE FROM phases WHERE id = ?").run(id); },
  };
}

function createTaskRepository(db: DatabasePort): TaskRepository {
  const durationExcludedStatuses = new Set(["BACKLOG", "TODO"]);
  async function recordStatusTransition(taskId: string, fromStatus: string | null, toStatus: string, changedAt: string, fallbackEnteredAt: string) {
    const active = await db.prepare("SELECT id, status, entered_at FROM task_status_history WHERE task_id = ? AND exited_at IS NULL ORDER BY entered_at DESC, id DESC LIMIT 1").get(taskId);
    if (active) {
      const seconds = terminalStatuses.has(String(active.status)) ? 0 : Math.max(0, Math.floor((Date.parse(changedAt) - Date.parse(String(active.entered_at))) / 1000));
      await db.prepare("UPDATE task_status_history SET exited_at = ?, duration_seconds = ? WHERE id = ?").run(changedAt, seconds, active.id);
    } else if (fromStatus && !terminalStatuses.has(fromStatus) && !durationExcludedStatuses.has(fromStatus)) {
      await db.prepare("INSERT INTO task_status_history (id, task_id, status, entered_at, exited_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), taskId, fromStatus, fallbackEnteredAt, changedAt, Math.max(0, Math.floor((Date.parse(changedAt) - Date.parse(fallbackEnteredAt)) / 1000)));
    }
    if (!terminalStatuses.has(toStatus) && !durationExcludedStatuses.has(toStatus)) await db.prepare("INSERT INTO task_status_history (id, task_id, status, entered_at, exited_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), taskId, toStatus, changedAt, null, null);
  }
  return {
    async findById(id) { const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); return row ? (await hydrateTasks(db, [toTask(row)]))[0]! : null; },
    async findByProjectNumber(projectId, number) { const row = await db.prepare("SELECT * FROM tasks WHERE project_id = ? AND number = ?").get(projectId, number); return row ? (await hydrateTasks(db, [toTask(row)]))[0]! : null; },
    async unassignForProjectMember(projectId, userId) { await db.prepare("UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE project_id = ? AND assignee_id = ?").run(new Date().toISOString(), projectId, userId); },
    async countByPhase(phaseId) { const row = await db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE phase_id = ?").get(phaseId); return Number(row?.count ?? 0); },
    async reassignPhase(fromPhaseId, toPhaseId) { const result = await db.prepare("UPDATE tasks SET phase_id = ?, updated_at = ? WHERE phase_id = ?").run(toPhaseId, new Date().toISOString(), fromPhaseId); return Number(result.changes ?? 0); },
    async deleteByPhase(phaseId) { const result = await db.prepare("DELETE FROM tasks WHERE phase_id = ?").run(phaseId); return Number(result.changes ?? 0); },
    async listByProject(projectId, filters = {}, page) {
      const where = ["project_id = ?"]; const values: unknown[] = [projectId];
      const filterMap: Record<string, string> = { status: "status", assigneeId: "assignee_id", priority: "priority", type: "type", phaseId: "phase_id" };
      for (const [key, column] of Object.entries(filterMap)) if (filters[key as keyof TaskFilters] !== undefined) { where.push(`${column} = ?`); values.push(filters[key as keyof TaskFilters]); }
      if (filters.tag) { where.push("EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = tasks.id AND tg.name = ? COLLATE NOCASE)"); values.push(filters.tag); }
      if (filters.minPoints !== undefined) { where.push("estimate_points >= ?"); values.push(filters.minPoints); }
      if (filters.maxPoints !== undefined) { where.push("estimate_points <= ?"); values.push(filters.maxPoints); }
      if (filters.query) { where.push("(title LIKE ? OR description LIKE ?)"); values.push(`%${filters.query}%`, `%${filters.query}%`); }
      const cursor = decodeCursor(page.cursor, 4);
      if (cursor) { const [status, position, createdAt, id] = cursor; where.push("(status > ? OR (status = ? AND position > ?) OR (status = ? AND position = ? AND created_at < ?) OR (status = ? AND position = ? AND created_at = ? AND id > ?))"); values.push(status, status, position, status, position, createdAt, status, position, createdAt, id); }
      const rows = await db.prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY status ASC, position ASC, created_at DESC, id ASC LIMIT ${page.limit + 1}`).all(...values);
      const mapped = await hydrateTasks(db, rows.map(toTask));
      return toPage(mapped, page, (task) => [task.status, task.position, task.createdAt, task.id]);
    },
    async allocateNumber(projectId, status) { const project = await db.prepare(`SELECT next_task_number FROM projects WHERE id = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(projectId); if (!project) throw new Error("Project not found"); const positionRow = await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tasks WHERE project_id = ? AND status = ?").get(projectId, status); const position = Number(positionRow?.next ?? 0); await db.prepare("UPDATE projects SET next_task_number = next_task_number + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), projectId); return { number: Number(project.next_task_number), position }; },
    async create(input) { await db.prepare(`INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id, parent_id, branch, due_date, estimate_points, phase_id, pull_request_url, pull_request_title, pull_request_state, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId, input.number, input.title, input.description, input.definitionOfDone, input.status, input.priority, input.type, input.assigneeId, input.creatorId, input.parentId, input.branch, input.dueDate, input.estimatePoints, input.phaseId, input.pullRequestUrl, input.pullRequestTitle, input.pullRequestState, input.position, input.createdAt, input.updatedAt); if (!terminalStatuses.has(input.status) && !durationExcludedStatuses.has(input.status)) await db.prepare("INSERT INTO task_status_history (id, task_id, status, entered_at, exited_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), input.id, input.status, input.createdAt, null, null); return (await hydrateTasks(db, [input]))[0]!; },
    async update(id, input) {
      const existing = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); if (!existing) throw new Error("Task not found");
      const columns: Record<string, string> = { title: "title", description: "description", definitionOfDone: "definition_of_done", status: "status", priority: "priority", type: "type", assigneeId: "assignee_id", parentId: "parent_id", branch: "branch", dueDate: "due_date", estimatePoints: "estimate_points", phaseId: "phase_id", pullRequestUrl: "pull_request_url", pullRequestTitle: "pull_request_title", pullRequestState: "pull_request_state", position: "position" }; const fields: string[] = []; const values: unknown[] = [];
      for (const [key, column] of Object.entries(columns)) if (key in input) { fields.push(`${column} = ?`); values.push(input[key as keyof typeof input] ?? null); }
      const changedAt = new Date().toISOString(); if (fields.length) { fields.push("updated_at = ?"); values.push(changedAt, id); await db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values); }
      if (input.status && input.status !== existing.status) await recordStatusTransition(id, String(existing.status), input.status, changedAt, date(existing.created_at));
      const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); if (!row) throw new Error("Task not found after update"); return (await hydrateTasks(db, [toTask(row)]))[0]!;
    },
    async activeAssignmentCounts(agentIds) {
      const counts = new Map(agentIds.map((id) => [id, 0]));
      if (!agentIds.length) return counts;
      const placeholders = agentIds.map(() => "?").join(", ");
      const rows = await db.prepare(`SELECT assignee_id, COUNT(*) AS count FROM tasks WHERE assignee_id IN (${placeholders}) AND status NOT IN ('DONE','CANCELLED','FAILED') GROUP BY assignee_id`).all(...agentIds);
      for (const row of rows) counts.set(text(row.assignee_id), Number(row.count));
      return counts;
    },
    async assignIfCapacity(taskId, agentId, maxConcurrency) {
      if (db.dialect === "mysql") await db.prepare("SELECT id FROM users WHERE id = ? FOR UPDATE").get(agentId);
      const task = await db.prepare(`SELECT assignee_id FROM tasks WHERE id = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(taskId);
      if (!task) throw new Error("Task not found");
      if (task.assignee_id === agentId) return "ALREADY_ASSIGNED";
      if (task.assignee_id) return "TASK_TAKEN";
      const activeAssignments = await db.prepare(`SELECT id FROM tasks WHERE assignee_id = ? AND status NOT IN ('DONE','CANCELLED','FAILED')${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).all(agentId);
      if (activeAssignments.length >= maxConcurrency) return "AT_CAPACITY";
      const result = await db.prepare("UPDATE tasks SET assignee_id = ?, updated_at = ? WHERE id = ? AND assignee_id IS NULL").run(agentId, new Date().toISOString(), taskId);
      return Number(result.changes ?? 0) === 1 ? "ASSIGNED" : "TASK_TAKEN";
    },
    async delete(id) { await db.prepare("DELETE FROM tasks WHERE id = ?").run(id); },
    async listForAssignee(assigneeId, status) {
      const where = ["t.assignee_id = ?"];
      const params: unknown[] = [assigneeId];
      if (status) { where.push("t.status = ?"); params.push(status); }
      const rows = await db.prepare(`SELECT t.*, p.name AS project_name, p.\`key\` AS project_key FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC`).all(...params);
      return rows.map((row) => ({ ...toTask(row), projectName: text(row.project_name), projectKey: text(row.project_key) }));
    },
    async listUsedStatuses(projectId) { return (await db.prepare("SELECT DISTINCT status FROM tasks WHERE project_id = ?").all(projectId)).map((row) => row.status as TaskStatus); },
    async hasIncompleteByPhase(phaseId) { return Boolean(await db.prepare("SELECT 1 FROM tasks WHERE phase_id = ? AND status NOT IN ('DONE','CANCELLED') LIMIT 1").get(phaseId)); },
    async claimNext(projectId, claimantId, workflow, options = {}) {
      if (!workflow.sourceStatuses.length || !workflow.dependencyResolutionStatuses.length) return null;
      const sourcePlaceholders = workflow.sourceStatuses.map(() => "?").join(", ");
      const resolutionPlaceholders = workflow.dependencyResolutionStatuses.map(() => "?").join(", ");
      const where = ["t.project_id = ?", `t.status IN (${sourcePlaceholders})`, "t.assignee_id IS NULL", `NOT EXISTS (SELECT 1 FROM task_dependencies td JOIN tasks dependency ON dependency.id = td.depends_on_task_id WHERE td.task_id = t.id AND dependency.status NOT IN (${resolutionPlaceholders}))`];
      const params: unknown[] = [projectId, ...workflow.sourceStatuses, ...workflow.dependencyResolutionStatuses];
      if (options.taskId) { where.push("t.id = ?"); params.push(options.taskId); }
      if (options.phaseId !== undefined && options.phaseId !== null) { where.push("t.phase_id = ?"); params.push(options.phaseId); }
      if (options.priority) { where.push("t.priority = ?"); params.push(options.priority); }
      const orderExpr = "CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.position";
      const candidate = await db.prepare(`SELECT t.id, t.status FROM tasks t WHERE ${where.join(" AND ")} ORDER BY ${orderExpr} LIMIT 1`).get(...params);
      if (!candidate) return null;
      const now = new Date().toISOString();
      const dependencyEligibility = `NOT EXISTS (SELECT 1 FROM task_dependencies td JOIN tasks dependency ON dependency.id = td.depends_on_task_id WHERE td.task_id = tasks.id AND dependency.status NOT IN (${resolutionPlaceholders}))`;
      const updateSql = db.dialect === "mysql"
        ? `UPDATE tasks SET assignee_id = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status IN (${sourcePlaceholders}) AND assignee_id IS NULL AND id IN (SELECT claimable.id FROM (SELECT eligible.id FROM tasks eligible WHERE eligible.id = ? AND NOT EXISTS (SELECT 1 FROM task_dependencies td JOIN tasks dependency ON dependency.id = td.depends_on_task_id WHERE td.task_id = eligible.id AND dependency.status NOT IN (${resolutionPlaceholders})) GROUP BY eligible.id) claimable)`
        : `UPDATE tasks SET assignee_id = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status IN (${sourcePlaceholders}) AND assignee_id IS NULL AND ${dependencyEligibility}`;
      const updateParams = db.dialect === "mysql"
        ? [claimantId, workflow.targetStatus, now, candidate.id, projectId, ...workflow.sourceStatuses, candidate.id, ...workflow.dependencyResolutionStatuses]
        : [claimantId, workflow.targetStatus, now, candidate.id, projectId, ...workflow.sourceStatuses, ...workflow.dependencyResolutionStatuses];
      const result = await db.prepare(updateSql).run(...updateParams);
      if (!result.changes) return null;
      const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(candidate.id);
      const hydrated = row ? (await hydrateTasks(db, [toTask(row)]))[0]! : null;
      return hydrated ? { ...hydrated, previousStatus: candidate.status as TaskStatus } : null;
    },
  };
}

function createTagRepository(db: DatabasePort): TaskTagRepository {
  return { async listForTask(taskId) { return (await db.prepare("SELECT * FROM tags JOIN task_tags ON task_tags.tag_id = tags.id WHERE task_tags.task_id = ? ORDER BY tags.name").all(taskId)).map(toTag); }, async listForProject(projectId) { return (await db.prepare("SELECT tags.*, COUNT(task_tags.task_id) AS task_count FROM tags LEFT JOIN task_tags ON task_tags.tag_id = tags.id WHERE tags.project_id = ? GROUP BY tags.id ORDER BY tags.name").all(projectId)).map((row) => ({ ...toTag(row), taskCount: Number(row.task_count) })); }, async replaceForTask(taskId, projectId, names, createdAt) { await db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId); for (const name of [...new Set(names)]) { const existing = await db.prepare("SELECT id FROM tags WHERE project_id = ? AND name = ?").get(projectId, name); const id = existing?.id ? text(existing.id) : randomUUID(); if (!existing) await db.prepare("INSERT INTO tags (id, project_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, projectId, name, createdAt); await db.prepare("INSERT INTO task_tags (task_id, tag_id, created_at) VALUES (?, ?, ?)").run(taskId, id, createdAt); } } };
}

function createDependencyRepository(db: DatabasePort): TaskDependencyRepository {
  return { async listForTask(taskId) { return (await db.prepare("SELECT td.task_id, td.depends_on_task_id, dep.project_id, p.`key` AS project_key, p.dependency_resolution_statuses, dep.number, dep.title, dep.status FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on_task_id JOIN projects p ON p.id = dep.project_id WHERE td.task_id = ? ORDER BY dep.number").all(taskId)).map(toDependency); }, async replaceForTask(taskId, dependencyIds, createdAt) { await db.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId); for (const dependencyId of [...new Set(dependencyIds)]) await db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)").run(taskId, dependencyId, createdAt); } };
}

function createUpdateRepository(db: DatabasePort): TaskUpdateRepository {
  return {
    async listForTask(taskId, page) {
      const where = ["tu.task_id = ?"];
      const params: unknown[] = [taskId];
      const cursor = decodeCursor(page.cursor, 2);
      if (cursor) { where.push("(tu.created_at < ? OR (tu.created_at = ? AND tu.id > ?))"); params.push(cursor[0], cursor[0], cursor[1]); }
      const rows = await db.prepare(`SELECT tu.*, u.id AS author_user_id, u.email AS author_email, u.name AS author_name, u.kind AS author_kind, u.role AS author_role, u.avatar_url AS author_avatar_url, u.created_at AS author_created_at FROM task_updates tu JOIN users u ON u.id = tu.author_id WHERE ${where.join(" AND ")} ORDER BY tu.created_at DESC, tu.id ASC LIMIT ${page.limit + 1}`).all(...params);
      return toPage(rows.map(toHydratedUpdate), page, (update) => [update.createdAt, update.id]);
    },
    async create(input) { await db.prepare("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.authorId, input.body, input.createdAt, input.updatedAt); return input; },
  };
}

function createAgentLogRepository(db: DatabasePort): AgentLogRepository {
  return {
    async listForTask(taskId, page) {
      const where = ["task_id = ?"]; const params: unknown[] = [taskId];
      const cursor = decodeCursor(page.cursor, 2);
      if (cursor) { where.push("(created_at < ? OR (created_at = ? AND id > ?))"); params.push(cursor[0], cursor[0], cursor[1]); }
      const rows = await db.prepare(`SELECT * FROM agent_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id ASC LIMIT ${page.limit + 1}`).all(...params);
      return toPage(rows.map(toAgentLog), page, (log) => [log.createdAt, log.id]);
    },
    async append(input) {
      try {
        await db.prepare("INSERT INTO agent_logs (id, task_id, run_id, provider, stream, category, `sequence`, event_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.runId, input.provider, input.stream, input.category, input.sequence, input.eventId, input.content, input.createdAt);
      } catch (error) {
        if (input.eventId && /unique|duplicate/i.test(error instanceof Error ? error.message : String(error))) return null;
        throw error;
      }
      return input;
    },
    async purgeForTask(taskId, keep) {
      const countRow = await db.prepare("SELECT COUNT(*) AS count FROM agent_logs WHERE task_id = ?").get(taskId) as { count?: number } | undefined;
      const count = Number(countRow?.count ?? 0);
      const offset = Math.max(0, keep);
      if (count <= offset) return 0;
      const rows = await db.prepare(`SELECT id FROM agent_logs WHERE task_id = ? ORDER BY created_at DESC, id ASC LIMIT ${count - offset} OFFSET ${offset}`).all(taskId);
      if (!rows.length) return 0;
      return (await db.prepare(`DELETE FROM agent_logs WHERE id IN (${rows.map(() => "?").join(",")})`).run(...rows.map((row) => row.id))).changes;
    },
  };
}

function createAttachmentRepository(db: DatabasePort): AttachmentRepository {
  return {
    async listForTask(taskId) { const rows = await db.prepare("SELECT a.*, u.id AS uploaded_user_id, u.email AS uploaded_email, u.name AS uploaded_name, u.kind AS uploaded_kind, u.role AS uploaded_role, u.avatar_url AS uploaded_avatar_url, u.created_at AS uploaded_created_at FROM task_attachments a JOIN users u ON u.id = a.uploaded_by_id WHERE a.task_id = ? ORDER BY a.created_at DESC").all(taskId); return rows.map((row) => ({ ...toAttachment(row), uploadedBy: { id: text(row.uploaded_user_id), email: nullableText(row.uploaded_email), name: text(row.uploaded_name), kind: row.uploaded_kind as UserEntity["kind"], role: row.uploaded_role as UserEntity["role"], avatarUrl: nullableText(row.uploaded_avatar_url), createdAt: date(row.uploaded_created_at) } })); },
    async findById(id) { const row = await db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(id); return row ? toAttachment(row) : null; },
    async create(input) { await db.prepare("INSERT INTO task_attachments (id, task_id, file_name, mime_type, file_size, storage_key, uploaded_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.fileName, input.mimeType, input.size, input.storageKey, input.uploadedById, input.createdAt); return input; },
    async delete(id) { await db.prepare("DELETE FROM task_attachments WHERE id = ?").run(id); },
  };
}

function createAutomationRepository(db: DatabasePort): AutomationRepository {
  return {
    async listForProject(projectId) { return (await db.prepare("SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC").all(projectId)).map(toAutomation); },
    async findById(id) { const row = await db.prepare("SELECT * FROM automations WHERE id = ?").get(id); return row ? toAutomation(row) : null; },
    async create(input) { await db.prepare("INSERT INTO automations (id, project_id, name, enabled, `trigger`, actor_type, actor_id, service, conditions, actions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.projectId, input.name, input.enabled ? 1 : 0, input.trigger, input.actorType, input.actorId, input.service, JSON.stringify(input.conditions), JSON.stringify(input.actions), input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const map: Record<string, string> = { name: "name", enabled: "enabled", trigger: "`trigger`", actorType: "actor_type", actorId: "actor_id", service: "service", conditions: "conditions", actions: "actions" }; const fields: string[] = []; const values: unknown[] = []; for (const [key, column] of Object.entries(map)) if (key in input) { fields.push(`${column} = ?`); const value = input[key as keyof typeof input]; values.push(key === "enabled" ? (value ? 1 : 0) : key === "conditions" || key === "actions" ? JSON.stringify(value) : value ?? null); } fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE automations SET ${fields.join(", ")} WHERE id = ?`).run(...values); const row = await db.prepare("SELECT * FROM automations WHERE id = ?").get(id); if (!row) throw new Error("Automation not found after update"); return toAutomation(row); },
    async delete(id) { await db.prepare("DELETE FROM automations WHERE id = ?").run(id); },
  };
}

function createNotificationRepository(db: DatabasePort): NotificationRepository {
  const select = "SELECT n.*, p.name AS project_name, p.`key` AS project_key, t.number AS task_number FROM notifications n LEFT JOIN projects p ON p.id = n.project_id LEFT JOIN tasks t ON t.id = n.task_id";
  return { async notify(input) { await db.prepare("INSERT INTO notifications (id, user_id, project_id, task_id, type, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), input.userId, input.projectId ?? null, input.taskId ?? null, input.type, input.title, input.message, new Date().toISOString()); }, async listForUser(userId, page) { const where = ["n.user_id = ?"]; const params: unknown[] = [userId]; const cursor = decodeCursor(page.cursor, 2); if (cursor) { where.push("(n.created_at < ? OR (n.created_at = ? AND n.id > ?))"); params.push(cursor[0], cursor[0], cursor[1]); } const [rows, unread] = await Promise.all([db.prepare(`${select} WHERE ${where.join(" AND ")} ORDER BY n.created_at DESC, n.id ASC LIMIT ${page.limit + 1}`).all(...params), db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId)]); return { ...toPage(rows.map(toNotification), page, (notification) => [notification.createdAt, notification.id]), unreadCount: Number(unread?.count ?? 0) }; }, async markRead(userId, id) { const result = await db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?").run(new Date().toISOString(), id, userId); if (!result.changes) throw new Error("Notification not found after read"); const row = await db.prepare(`${select} WHERE n.id = ? AND n.user_id = ?`).get(id, userId); if (!row) throw new Error("Notification not found after read"); return toNotification(row); }, async markAllRead(userId) { return (await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(new Date().toISOString(), userId)).changes; } };
}

function createTokenRepository(db: DatabasePort): ApiTokenRepository {
  return {
    async create(input) { await db.prepare("INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, token_ciphertext, permissions, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.userId, input.name, input.prefix, input.hash, input.ciphertext, input.permissions ? JSON.stringify(input.permissions) : null, input.expiresAt, input.createdAt); },
    async listForUser(userId) { return (await db.prepare("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId)).map((row) => { const token = toToken(row); const { ciphertext: _ciphertext, ...metadata } = token; return metadata; }); },
    async findById(id) { const row = await db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id); return row ? { ...toToken(row), userId: String(row.user_id), ciphertext: nullableText(row.token_ciphertext) } : null; },
    async revoke(id) { await db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), id); },
    async findRunCredential(runId) { const row = await db.prepare("SELECT * FROM agent_run_credentials WHERE run_id = ?").get(runId); return row ? toRunCredential(row) : null; },
    async saveRunCredential(input) {
      const values = [input.runId, input.taskId, input.projectId, input.userId, input.runAttempt, input.prefix, input.hash, input.ciphertext, JSON.stringify(input.permissions), input.expiresAt, input.lastUsedAt, input.revokedAt, input.createdAt, input.updatedAt];
      const sql = db.dialect === "mysql"
        ? "INSERT INTO agent_run_credentials (run_id, task_id, project_id, user_id, run_attempt, token_prefix, token_hash, token_ciphertext, permissions, expires_at, last_used_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE task_id = VALUES(task_id), project_id = VALUES(project_id), user_id = VALUES(user_id), run_attempt = VALUES(run_attempt), token_prefix = VALUES(token_prefix), token_hash = VALUES(token_hash), token_ciphertext = VALUES(token_ciphertext), permissions = VALUES(permissions), expires_at = VALUES(expires_at), last_used_at = VALUES(last_used_at), revoked_at = VALUES(revoked_at), created_at = VALUES(created_at), updated_at = VALUES(updated_at)"
        : "INSERT INTO agent_run_credentials (run_id, task_id, project_id, user_id, run_attempt, token_prefix, token_hash, token_ciphertext, permissions, expires_at, last_used_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET task_id = excluded.task_id, project_id = excluded.project_id, user_id = excluded.user_id, run_attempt = excluded.run_attempt, token_prefix = excluded.token_prefix, token_hash = excluded.token_hash, token_ciphertext = excluded.token_ciphertext, permissions = excluded.permissions, expires_at = excluded.expires_at, last_used_at = excluded.last_used_at, revoked_at = excluded.revoked_at, created_at = excluded.created_at, updated_at = excluded.updated_at";
      await db.prepare(sql).run(...values);
      return input;
    },
    async revokeRunCredential(runId, revokedAt) { await db.prepare("UPDATE agent_run_credentials SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE run_id = ?").run(revokedAt, revokedAt, runId); },
  };
}

function createActivityRepository(db: DatabasePort): ActivityRepository {
  return {
    async record(input) { await db.prepare("INSERT INTO activity (id, project_id, task_id, actor_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), input.projectId, input.taskId ?? null, input.actorId, input.action, JSON.stringify(input.metadata ?? {}), new Date().toISOString()); },
    async list(filters) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filters.projectId) { where.push("a.project_id = ?"); params.push(filters.projectId); }
      if (filters.taskId) { where.push("a.task_id = ?"); params.push(filters.taskId); }
      if (filters.actorId) { where.push("a.actor_id = ?"); params.push(filters.actorId); }
      const cursor = decodeCursor(filters.page.cursor, 2);
      if (cursor) { where.push("(a.created_at < ? OR (a.created_at = ? AND a.id > ?))"); params.push(cursor[0], cursor[0], cursor[1]); }
      const rows = await db.prepare(`SELECT a.*, u.name AS actor_name, u.kind AS actor_kind, u.avatar_url AS actor_avatar_url, p.\`key\` AS project_key, t.number AS task_number FROM activity a JOIN users u ON u.id = a.actor_id JOIN projects p ON p.id = a.project_id LEFT JOIN tasks t ON t.id = a.task_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC, a.id ASC LIMIT ${filters.page.limit + 1}`).all(...params);
      const items = rows.map((row) => {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(String(row.metadata ?? "{}")); } catch { /* empty */ }
        return { id: text(row.id), projectId: text(row.project_id), projectKey: text(row.project_key), taskId: nullableText(row.task_id), taskNumber: row.task_number == null ? null : Number(row.task_number), actorId: text(row.actor_id), actorName: text(row.actor_name), actorKind: row.actor_kind as UserEntity["kind"], actorAvatarUrl: nullableText(row.actor_avatar_url), action: text(row.action), metadata, createdAt: date(row.created_at) };
      });
      return toPage(items, filters.page, (activity) => [activity.createdAt, activity.id]);
    },
  };
}

function createWebhookDeliveryRepository(db: DatabasePort): WebhookDeliveryRepository {
  const adminSelect = "SELECT d.*, u.name AS agent_name, t.number AS task_number, p.`key` AS project_key FROM webhook_deliveries d JOIN users u ON u.id = d.agent_id LEFT JOIN tasks t ON t.id = d.task_id LEFT JOIN projects p ON p.id = t.project_id";
  return {
    async create(input) {
      await db.prepare("INSERT INTO webhook_deliveries (id, agent_id, task_id, event_type, payload, status, attempt_count, next_attempt_at, locked_until, last_attempt_at, delivered_at, failed_at, last_error, http_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.agentId, input.taskId, input.eventType, input.payload, input.status, input.attemptCount, input.nextAttemptAt, input.lockedUntil, input.lastAttemptAt, input.deliveredAt, input.failedAt, input.lastError, input.httpStatus, input.createdAt, input.updatedAt);
      return input;
    },
    async findById(id) { const row = await db.prepare(`${adminSelect} WHERE d.id = ?`).get(id); return row ? toWebhookDelivery(row) : null; },
    async list(filters) {
      const where: string[] = []; const params: unknown[] = [];
      if (filters.agentId) { where.push("d.agent_id = ?"); params.push(filters.agentId); }
      if (filters.status) { where.push("d.status = ?"); params.push(filters.status); }
      return (await db.prepare(`${adminSelect}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY d.created_at DESC LIMIT ${queryLimit(filters.limit)}`).all(...params)).map(toWebhookDelivery);
    },
    async listDue(now, limit) { return (await db.prepare(`SELECT id FROM webhook_deliveries WHERE status IN ('PENDING', 'RETRYING') AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?) ORDER BY next_attempt_at, created_at LIMIT ${queryLimit(limit)}`).all(now, now)).map((row) => text(row.id)); },
    async claim(id, now, lockedUntil) { return Boolean((await db.prepare("UPDATE webhook_deliveries SET attempt_count = attempt_count + 1, last_attempt_at = ?, locked_until = ?, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'RETRYING') AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?)").run(now, lockedUntil, now, id, now, now)).changes); },
    async markDelivered(id, deliveredAt, httpStatus) { await db.prepare("UPDATE webhook_deliveries SET status = 'DELIVERED', delivered_at = ?, failed_at = NULL, last_error = NULL, http_status = ?, locked_until = NULL, updated_at = ? WHERE id = ?").run(deliveredAt, httpStatus, deliveredAt, id); },
    async markRetry(id, nextAttemptAt, lastError, httpStatus, updatedAt) { await db.prepare("UPDATE webhook_deliveries SET status = 'RETRYING', next_attempt_at = ?, last_error = ?, http_status = ?, locked_until = NULL, updated_at = ? WHERE id = ?").run(nextAttemptAt, lastError, httpStatus, updatedAt, id); },
    async markFailed(id, failedAt, lastError, httpStatus) { await db.prepare("UPDATE webhook_deliveries SET status = 'FAILED', failed_at = ?, last_error = ?, http_status = ?, locked_until = NULL, updated_at = ? WHERE id = ?").run(failedAt, lastError, httpStatus, failedAt, id); },
    async retry(id, nextAttemptAt) { return Boolean((await db.prepare("UPDATE webhook_deliveries SET status = 'RETRYING', attempt_count = 0, next_attempt_at = ?, locked_until = NULL, failed_at = NULL, last_error = NULL, http_status = NULL, updated_at = ? WHERE id = ? AND status = 'FAILED'").run(nextAttemptAt, nextAttemptAt, id)).changes); },
    async metrics() { const rows = await db.prepare("SELECT status, COUNT(*) AS count FROM webhook_deliveries GROUP BY status").all(); const result = { PENDING: 0, RETRYING: 0, DELIVERED: 0, FAILED: 0 }; for (const row of rows) { const status = String(row.status); if (status in result) result[status as keyof typeof result] = Number(row.count); } return result; },
    async purgeDelivered(before, limit) { const rows = await db.prepare(`SELECT id FROM webhook_deliveries WHERE status = 'DELIVERED' AND delivered_at < ? ORDER BY delivered_at, id LIMIT ${queryLimit(limit)}`).all(before); let removed = 0; for (const row of rows) removed += (await db.prepare("DELETE FROM webhook_deliveries WHERE id = ? AND status = 'DELIVERED'").run(text(row.id))).changes; return removed; },
  };
}

function toAgentRun(row: Record<string, unknown>): AgentRunEntity {
  return { id: text(row.id), taskId: text(row.task_id), projectId: text(row.project_id), requestedById: text(row.requested_by_id), executedById: nullableText(row.executed_by_id), kind: row.kind as AgentRunEntity["kind"], status: row.status as AgentRunEntity["status"], controlState: (row.control_state ?? "ACTIVE") as AgentRunEntity["controlState"], controlVersion: Number(row.control_version ?? 0), assignedAgentId: nullableText(row.assigned_agent_id), inputRequest: nullableText(row.input_request), inputResponse: nullableText(row.input_response), inputRequestedAt: nullableText(row.input_requested_at), inputAnsweredAt: nullableText(row.input_answered_at), takeoverById: nullableText(row.takeover_by_id), attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), leaseOwner: nullableText(row.lease_owner), leaseExpiresAt: nullableText(row.lease_expires_at), heartbeatAt: nullableText(row.heartbeat_at), timeoutAt: nullableText(row.timeout_at), lastError: nullableText(row.last_error), createdAt: date(row.created_at), updatedAt: date(row.updated_at), completedAt: nullableText(row.completed_at), contextPackVersion: Number(row.context_pack_version ?? 0), contextPackFingerprint: nullableText(row.context_pack_fingerprint) };
}

function createAgentRunRepository(db: DatabasePort): AgentRunRepository {
  const toCycleGrant = (row: Row): import("../application/models.js").AgentCycleGrantEntity => ({ taskId: text(row.task_id), priorCount: Number(row.prior_count), newLimit: Number(row.new_limit), requestId: text(row.request_id), smithyEventId: text(row.smithy_event_id), actorId: text(row.actor_id), createdAt: date(row.created_at) });
  return {
    async create(input) { await db.prepare("INSERT INTO agent_runs (id, task_id, project_id, requested_by_id, executed_by_id, kind, status, control_state, control_version, assigned_agent_id, input_request, input_response, input_requested_at, input_answered_at, takeover_by_id, attempt_count, max_attempts, lease_owner, lease_expires_at, heartbeat_at, timeout_at, last_error, created_at, updated_at, completed_at, context_pack_version, context_pack_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.projectId, input.requestedById, input.executedById, input.kind, input.status, input.controlState, input.controlVersion, input.assignedAgentId, input.inputRequest, input.inputResponse, input.inputRequestedAt, input.inputAnsweredAt, input.takeoverById, input.attemptCount, input.maxAttempts, input.leaseOwner, input.leaseExpiresAt, input.heartbeatAt, input.timeoutAt, input.lastError, input.createdAt, input.updatedAt, input.completedAt, input.contextPackVersion, input.contextPackFingerprint); return input; },
    async findById(id) { const row = await db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id); return row ? toAgentRun(row) : null; },
    async listForTask(taskId) { return (await db.prepare("SELECT * FROM agent_runs WHERE task_id = ? ORDER BY created_at DESC, id DESC").all(taskId)).map(toAgentRun); },
    async countForTask(taskId) { const row = await db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?").get(taskId); return Number(row?.count ?? 0); },
    async cycleState(taskId) {
      const [runRow, grantRows, failureRow] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE task_id = ?").get(taskId),
        db.prepare("SELECT request_id, created_at FROM agent_cycle_grants WHERE task_id = ? ORDER BY created_at DESC, request_id DESC").all(taskId),
        db.prepare("SELECT event_id, created_at FROM agent_logs WHERE task_id = ? AND content LIKE ? ORDER BY created_at DESC, id DESC LIMIT 1").get(taskId, "%maximum autonomous delivery cycle limit%"),
      ]);
      const count = Number(runRow?.count ?? 0);
      const limit = 6 + grantRows.length;
      const latestGrantAt = grantRows[0] ? date(grantRows[0].created_at) : null;
      const failureAt = failureRow ? date(failureRow.created_at) : null;
      const rawLogEventId = failureRow ? nullableText(failureRow.event_id) : null;
      const parts = rawLogEventId?.split(":") ?? [];
      const failureEventId = parts.length >= 3 ? parts.slice(0, -2).join(":") : null;
      const limitFailure = count >= limit && Boolean(failureEventId) && (!latestGrantAt || failureAt! > latestGrantAt);
      return { count, limit, limitFailure, failureEventId: limitFailure ? failureEventId : null };
    },
    async findCycleGrant(requestId) { const row = await db.prepare("SELECT * FROM agent_cycle_grants WHERE request_id = ?").get(requestId); return row ? toCycleGrant(row) : null; },
    async grantCycle(input) {
      const result = await db.prepare("INSERT OR IGNORE INTO agent_cycle_grants (task_id, prior_count, new_limit, request_id, smithy_event_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.taskId, input.priorCount, input.newLimit, input.requestId, input.smithyEventId, input.actorId, input.createdAt);
      const row = await db.prepare("SELECT * FROM agent_cycle_grants WHERE task_id = ? AND prior_count = ?").get(input.taskId, input.priorCount);
      if (!row) throw new Error("Cycle grant was not found after insert");
      return { grant: toCycleGrant(row), created: result.changes > 0 };
    },
    async expire(now) { return (await db.prepare("UPDATE agent_runs SET status = 'FAILED', last_error = COALESCE(last_error, 'Run lease or timeout expired'), completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE control_state = 'ACTIVE' AND status IN ('PENDING', 'RUNNING') AND ((timeout_at IS NOT NULL AND timeout_at <= ?) OR (lease_expires_at IS NOT NULL AND lease_expires_at <= ?))").run(now, now, now, now)).changes; },
    async claim(id, owner, now, leaseExpiresAt) { return Boolean((await db.prepare("UPDATE agent_runs SET status = 'RUNNING', attempt_count = attempt_count + 1, control_version = control_version + 1, executed_by_id = ?, lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, completed_at = NULL, updated_at = ? WHERE id = ? AND control_state = 'ACTIVE' AND (assigned_agent_id IS NULL OR assigned_agent_id = ?) AND status IN ('PENDING', 'FAILED') AND attempt_count < max_attempts").run(owner, owner, leaseExpiresAt, now, now, id, owner)).changes); },
    async heartbeat(id, owner, controlVersion, now, leaseExpiresAt) { return Boolean((await db.prepare("UPDATE agent_runs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'RUNNING' AND control_state = 'ACTIVE' AND control_version = ? AND lease_owner = ?").run(now, leaseExpiresAt, now, id, controlVersion, owner)).changes); },
    async complete(id, owner, controlVersion, status, now, error = null) { return Boolean((await db.prepare("UPDATE agent_runs SET status = ?, last_error = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'RUNNING' AND control_state = 'ACTIVE' AND control_version = ? AND lease_owner = ?").run(status, error, now, now, id, controlVersion, owner)).changes); },
    async cancel(id, now, error = null) { return Boolean((await db.prepare("UPDATE agent_runs SET status = 'CANCELLED', last_error = ?, completed_at = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status IN ('PENDING', 'RUNNING', 'FAILED')").run(error, now, now, id)).changes); },
    async findIntervention(requestId) {
      const row = await db.prepare("SELECT * FROM agent_run_interventions WHERE request_id = ?").get(requestId);
      return row ? { requestId: text(row.request_id), runId: text(row.run_id), actorId: text(row.actor_id), action: row.action as import("@taskforge/contracts").AgentRunInterventionAction, payloadHash: text(row.payload_hash), resultVersion: Number(row.result_version), createdAt: date(row.created_at) } : null;
    },
    async applyIntervention(id, expectedVersion, update, now) {
      const names: Record<string, string> = { status: "status", controlState: "control_state", assignedAgentId: "assigned_agent_id", inputRequest: "input_request", inputResponse: "input_response", inputRequestedAt: "input_requested_at", inputAnsweredAt: "input_answered_at", takeoverById: "takeover_by_id", lastError: "last_error", completedAt: "completed_at" };
      const entries = Object.entries(update).filter(([key]) => names[key]);
      const assignments = entries.map(([key]) => `${names[key]} = ?`);
      const values = entries.map(([, value]) => value);
      const result = await db.prepare(`UPDATE agent_runs SET ${assignments.join(", ")}, control_version = control_version + 1, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND control_version = ?`).run(...values, now, id, expectedVersion);
      return Boolean(result.changes);
    },
    async recordIntervention(input) { await db.prepare("INSERT INTO agent_run_interventions (request_id, run_id, actor_id, action, payload_hash, result_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.requestId, input.runId, input.actorId, input.action, input.payloadHash, input.resultVersion, input.createdAt); },
  };
}

function toAgentContextPack(row: Row): AgentContextPackEntity {
  const content = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
  return {
    id: text(row.id), runId: text(row.run_id), taskId: text(row.task_id), projectId: text(row.project_id),
    version: Number(row.version), fingerprint: text(row.fingerprint), content,
    refreshedFromVersion: row.refreshed_from_version == null ? null : Number(row.refreshed_from_version),
    refreshReason: row.refresh_reason as AgentContextPackEntity["refreshReason"], createdById: text(row.created_by_id), createdAt: date(row.created_at),
  } as AgentContextPackEntity;
}

function createAgentContextPackRepository(db: DatabasePort): AgentContextPackRepository {
  return {
    async findCurrent(runId) {
      const row = await db.prepare("SELECT * FROM agent_context_packs WHERE run_id = ? ORDER BY version DESC LIMIT 1").get(runId);
      return row ? toAgentContextPack(row) : null;
    },
    async listForRun(runId) { return (await db.prepare("SELECT * FROM agent_context_packs WHERE run_id = ? ORDER BY version DESC").all(runId)).map(toAgentContextPack); },
    async nextVersion(runId) {
      if (db.dialect === "mysql") await db.prepare("SELECT id FROM agent_runs WHERE id = ? FOR UPDATE").get(runId);
      const row = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM agent_context_packs WHERE run_id = ?").get(runId);
      return Number(row?.next_version ?? 1);
    },
    async create(input) {
      await db.prepare("INSERT INTO agent_context_packs (id, run_id, task_id, project_id, version, fingerprint, content, refreshed_from_version, refresh_reason, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.runId, input.taskId, input.projectId, input.version, input.fingerprint, JSON.stringify(input.content), input.refreshedFromVersion, input.refreshReason, input.createdById, input.createdAt);
      await db.prepare("UPDATE agent_runs SET context_pack_version = ?, context_pack_fingerprint = ?, updated_at = ? WHERE id = ?").run(input.version, input.fingerprint, input.createdAt, input.runId);
      return input;
    },
  };
}

function toTaskGate(row: Row, approvals: TaskGateEntity["approvals"] = []): TaskGateEntity {
  const parse = (value: unknown) => { try { return JSON.parse(String(value ?? "[]")); } catch { return []; } };
  return { taskId: text(row.task_id), headSha: text(row.head_sha), requiredChecks: parse(row.required_checks) as string[], requiredArtifactTypes: parse(row.required_artifact_types) as AgentArtifactType[], checks: parse(row.checks_json) as TaskGateEntity["checks"], implementationRunId: nullableText(row.implementation_run_id), implementationAgentId: nullableText(row.implementation_agent_id), approvals, approvedHeadSha: nullableText(row.approved_head_sha), approvedById: nullableText(row.approved_by_id), approvedAt: nullableText(row.approved_at), mergedHeadSha: nullableText(row.merged_head_sha), mergedById: nullableText(row.merged_by_id), mergedAt: nullableText(row.merged_at), updatedAt: text(row.updated_at) };
}

function createTaskGateRepository(db: DatabasePort): TaskGateRepository {
  return {
    async findByTask(taskId) { const row = await db.prepare("SELECT * FROM task_gate_evidence WHERE task_id = ?").get(taskId); if (!row) return null; const approvals = await db.prepare("SELECT reviewer_id, approved_at FROM task_gate_approvals WHERE task_id = ? AND head_sha = ? ORDER BY approved_at, reviewer_id").all(taskId, row.head_sha); return toTaskGate(row, approvals.map((approval) => ({ reviewerId: text(approval.reviewer_id), approvedAt: text(approval.approved_at) }))); },
    async save(input) {
      const existing = await db.prepare("SELECT task_id, head_sha, approved_head_sha FROM task_gate_evidence WHERE task_id = ?").get(input.taskId);
      const values = [input.headSha, JSON.stringify(input.requiredChecks), JSON.stringify(input.requiredArtifactTypes ?? []), JSON.stringify(input.checks), input.implementationRunId, input.implementationAgentId, input.approvedHeadSha, input.approvedById, input.approvedAt, input.mergedHeadSha, input.mergedById, input.mergedAt, input.updatedAt, input.taskId];
      if (existing) await db.prepare("UPDATE task_gate_evidence SET head_sha = ?, required_checks = ?, required_artifact_types = ?, checks_json = ?, implementation_run_id = ?, implementation_agent_id = ?, approved_head_sha = ?, approved_by_id = ?, approved_at = ?, merged_head_sha = ?, merged_by_id = ?, merged_at = ?, updated_at = ? WHERE task_id = ?").run(...values);
      else await db.prepare("INSERT INTO task_gate_evidence (head_sha, required_checks, required_artifact_types, checks_json, implementation_run_id, implementation_agent_id, approved_head_sha, approved_by_id, approved_at, merged_head_sha, merged_by_id, merged_at, updated_at, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...values);
      if (existing && (text(existing.head_sha) !== input.headSha || (nullableText(existing.approved_head_sha) !== null && input.approvedHeadSha === null))) await db.prepare("DELETE FROM task_gate_approvals WHERE task_id = ?").run(input.taskId);
      return this.findByTask(input.taskId) as Promise<TaskGateEntity>;
    },
    async invalidateApprovals(taskId) { await db.prepare("DELETE FROM task_gate_approvals WHERE task_id = ?").run(taskId); },
    async approve(taskId, headSha, actorId, policy, now) {
      const gate = await db.prepare("SELECT task_id FROM task_gate_evidence WHERE task_id = ? AND head_sha = ?").get(taskId, headSha);
      if (!gate) return null;
      await db.prepare(db.dialect === "mysql" ? "INSERT IGNORE INTO task_gate_approvals (task_id, head_sha, reviewer_id, approved_at) VALUES (?, ?, ?, ?)" : "INSERT OR IGNORE INTO task_gate_approvals (task_id, head_sha, reviewer_id, approved_at) VALUES (?, ?, ?, ?)").run(taskId, headSha, actorId, now);
      const eligibility = ["task_id = ?", "head_sha = ?"];
      const eligibilityParams: unknown[] = [taskId, headSha];
      if (policy.excludedReviewerId) { eligibility.push("reviewer_id <> ?"); eligibilityParams.push(policy.excludedReviewerId); }
      if (policy.allowedReviewerIds.length) { eligibility.push(`reviewer_id IN (${policy.allowedReviewerIds.map(() => "?").join(", ")})`); eligibilityParams.push(...policy.allowedReviewerIds); }
      const count = Number((await db.prepare(`SELECT COUNT(*) AS count FROM task_gate_approvals WHERE ${eligibility.join(" AND ")}`).get(...eligibilityParams))?.count ?? 0);
      if (count >= policy.requiredReviewerCount) await db.prepare("UPDATE task_gate_evidence SET approved_head_sha = head_sha, approved_by_id = ?, approved_at = ?, updated_at = ? WHERE task_id = ? AND head_sha = ?").run(actorId, now, now, taskId, headSha);
      else await db.prepare("UPDATE task_gate_evidence SET approved_head_sha = NULL, approved_by_id = NULL, approved_at = NULL, updated_at = ? WHERE task_id = ? AND head_sha = ?").run(now, taskId, headSha);
      return this.findByTask(taskId);
    },
    async merge(taskId, headSha, actorId, now) { const result = await db.prepare("UPDATE task_gate_evidence SET merged_head_sha = head_sha, merged_by_id = ?, merged_at = ?, updated_at = ? WHERE task_id = ? AND head_sha = ? AND approved_head_sha = ?").run(actorId, now, now, taskId, headSha, headSha); return result.changes ? this.findByTask(taskId) : null; },
  };
}

function toTaskFinding(row: Row): TaskFindingEntity {
  return { id: text(row.id), taskId: text(row.task_id), runId: nullableText(row.run_id), authorId: text(row.author_id), severity: row.severity as TaskFindingEntity["severity"], title: text(row.title), body: text(row.body), filePath: nullableText(row.file_path), lineNumber: row.line_number == null ? null : Number(row.line_number), disposition: row.disposition as TaskFindingEntity["disposition"], dispositionById: nullableText(row.disposition_by_id), dispositionReason: nullableText(row.disposition_reason), decisionOwnerId: nullableText(row.decision_owner_id), dueAt: nullableText(row.due_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}

function createTaskFindingRepository(db: DatabasePort): TaskFindingRepository {
  return {
    async listForTask(taskId) { return (await db.prepare("SELECT * FROM task_findings WHERE task_id = ? ORDER BY created_at ASC, id ASC").all(taskId)).map(toTaskFinding); },
    async findById(id) { const row = await db.prepare("SELECT * FROM task_findings WHERE id = ?").get(id); return row ? toTaskFinding(row) : null; },
    async create(input) { await db.prepare("INSERT INTO task_findings (id, task_id, run_id, author_id, severity, title, body, file_path, line_number, disposition, disposition_by_id, disposition_reason, decision_owner_id, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.runId, input.authorId, input.severity, input.title, input.body, input.filePath, input.lineNumber, input.disposition, input.dispositionById, input.dispositionReason, input.decisionOwnerId, input.dueAt, input.createdAt, input.updatedAt); return input; },
    async dispose(id, disposition, actorId, reason, decisionOwnerId, dueAt, updatedAt) { const result = await db.prepare("UPDATE task_findings SET disposition = ?, disposition_by_id = ?, disposition_reason = ?, decision_owner_id = ?, due_at = ?, updated_at = ? WHERE id = ? AND disposition IN ('OPEN', 'DEFERRED', 'ESCALATED')").run(disposition, actorId, reason, decisionOwnerId, dueAt, updatedAt, id); return result.changes ? this.findById(id) : null; },
  };
}

function toAgentHandoff(row: Row): AgentHandoffEntity { return { runId: text(row.run_id), taskId: text(row.task_id), branch: nullableText(row.branch), headSha: nullableText(row.head_sha), branchPublished: Boolean(row.branch_published), pullRequestUrl: nullableText(row.pull_request_url), pullRequestTitle: nullableText(row.pull_request_title), pullRequestState: nullableText(row.pull_request_state) as AgentHandoffEntity["pullRequestState"], status: row.status as AgentHandoffEntity["status"], lastError: nullableText(row.last_error), createdAt: date(row.created_at), updatedAt: date(row.updated_at) }; }
function createAgentHandoffRepository(db: DatabasePort): AgentHandoffRepository { return { async findByRun(runId) { const row = await db.prepare("SELECT * FROM agent_run_handoffs WHERE run_id = ?").get(runId); return row ? toAgentHandoff(row) : null; }, async findPublishedByTaskHead(taskId, headSha) { const row = await db.prepare("SELECT h.* FROM agent_run_handoffs h JOIN agent_runs r ON r.id = h.run_id WHERE h.task_id = ? AND h.head_sha = ? AND h.status = 'PUBLISHED' AND r.kind IN ('IMPLEMENTATION', 'FIX') ORDER BY h.updated_at DESC LIMIT 1").get(taskId, headSha); return row ? toAgentHandoff(row) : null; }, async save(input) { const exists = await db.prepare("SELECT run_id FROM agent_run_handoffs WHERE run_id = ?").get(input.runId); const values = [input.taskId, input.branch, input.headSha, input.branchPublished ? 1 : 0, input.pullRequestUrl, input.pullRequestTitle, input.pullRequestState, input.status, input.lastError, input.createdAt, input.updatedAt, input.runId]; if (exists) await db.prepare("UPDATE agent_run_handoffs SET task_id=?, branch=?, head_sha=?, branch_published=?, pull_request_url=?, pull_request_title=?, pull_request_state=?, status=?, last_error=?, created_at=?, updated_at=? WHERE run_id=?").run(...values); else await db.prepare("INSERT INTO agent_run_handoffs (task_id,branch,head_sha,branch_published,pull_request_url,pull_request_title,pull_request_state,status,last_error,created_at,updated_at,run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(...values); return input; } }; }

function toAgentPlan(row: Row): AgentPlanEntity {
  const parse = <T>(value: unknown, fallback: T): T => { try { return (typeof value === "string" ? JSON.parse(value) : value) as T; } catch { return fallback; } };
  return {
    id: text(row.id), taskId: text(row.task_id), sourceRunId: text(row.source_run_id), version: Number(row.version), status: row.status as AgentPlanEntity["status"], summary: text(row.summary),
    risks: parse(row.risks, []), acceptanceEvidence: parse(row.acceptance_evidence, []), requiresApproval: Boolean(row.requires_approval), items: parse(row.items, []), createdTaskIds: parse(row.created_task_ids, {}),
    idempotencyKey: text(row.idempotency_key), proposedById: text(row.proposed_by_id), reviewedById: nullableText(row.reviewed_by_id), reviewComment: nullableText(row.review_comment), createdAt: date(row.created_at), reviewedAt: nullableText(row.reviewed_at),
  };
}

function createAgentPlanRepository(db: DatabasePort): AgentPlanRepository {
  return {
    async lockTask(taskId) { await db.prepare(`SELECT id FROM tasks WHERE id = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(taskId); },
    async listForTask(taskId) { return (await db.prepare("SELECT * FROM agent_plans WHERE task_id = ? ORDER BY version DESC").all(taskId)).map(toAgentPlan); },
    async findById(id) { const row = await db.prepare("SELECT * FROM agent_plans WHERE id = ?").get(id); return row ? toAgentPlan(row) : null; },
    async findByIdempotency(sourceRunId, key) { const row = await db.prepare(`SELECT * FROM agent_plans WHERE source_run_id = ? AND idempotency_key = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(sourceRunId, key); return row ? toAgentPlan(row) : null; },
    async nextVersion(taskId) { const row = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM agent_plans WHERE task_id = ?").get(taskId); return Number(row?.version ?? 1); },
    async create(input) { await db.prepare("INSERT INTO agent_plans (id, task_id, source_run_id, version, status, summary, risks, acceptance_evidence, requires_approval, items, created_task_ids, idempotency_key, proposed_by_id, reviewed_by_id, review_comment, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.sourceRunId, input.version, input.status, input.summary, JSON.stringify(input.risks), JSON.stringify(input.acceptanceEvidence), input.requiresApproval ? 1 : 0, JSON.stringify(input.items), JSON.stringify(input.createdTaskIds), input.idempotencyKey, input.proposedById, input.reviewedById, input.reviewComment, input.createdAt, input.reviewedAt); return input; },
    async decide(id, expectedStatus, input) { const result = await db.prepare("UPDATE agent_plans SET status = ?, created_task_ids = ?, reviewed_by_id = ?, review_comment = ?, reviewed_at = ? WHERE id = ? AND status = ?").run(input.status, JSON.stringify(input.createdTaskIds), input.reviewedById, input.reviewComment, input.reviewedAt, id, expectedStatus); return Boolean(result.changes); },
  };
}

function createReportingRepository(db: DatabasePort): ReportingRepository {
  return {
    async countTasksByProject(projectIds) {
      if (!projectIds.length) return [];
      const placeholders = projectIds.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT project_id, status, COUNT(*) AS task_count FROM tasks WHERE project_id IN (${placeholders}) GROUP BY project_id, status`).all(...projectIds);
      return rows.map((row): TaskStatusCountEntity => ({ projectId: text(row.project_id), status: row.status as TaskStatus, count: Number(row.task_count) }));
    },
    async countNonDonePhasesByProject(projectIds) {
      if (!projectIds.length) return [];
      const placeholders = projectIds.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT p.project_id, COUNT(DISTINCT p.id) AS non_done_phase_count FROM phases p JOIN tasks t ON t.phase_id = p.id WHERE p.project_id IN (${placeholders}) AND t.status NOT IN ('DONE', 'CANCELLED') GROUP BY p.project_id`).all(...projectIds);
      return rows.map((row) => ({ projectId: text(row.project_id), nonDonePhaseCount: Number(row.non_done_phase_count) }));
    },
    async listMyOpenTasks(assigneeId, limit) {
      const rows = await db.prepare(`SELECT t.id, t.number, t.title, t.project_id, t.status, t.assignee_id, t.updated_at, p.\`key\` AS project_key, p.name AS project_name, u.name AS assignee_name FROM tasks t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.assignee_id WHERE t.assignee_id = ? AND t.status NOT IN ('DONE', 'CANCELLED', 'BACKLOG') ORDER BY t.updated_at DESC LIMIT ${queryLimit(limit)}`).all(assigneeId);
      return rows.map(toReportingTask);
    },
    async listStuckTasks(projectIds, updatedBefore, limit) {
      if (!projectIds.length) return [];
      const placeholders = projectIds.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT t.id, t.number, t.title, t.project_id, t.status, t.assignee_id, t.updated_at, p.\`key\` AS project_key, p.name AS project_name, u.name AS assignee_name FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id IN (${placeholders}) AND t.status = 'IN_PROGRESS' AND t.updated_at < ? ORDER BY t.updated_at ASC LIMIT ${queryLimit(limit)}`).all(...projectIds, updatedBefore);
      return rows.map(toReportingTask);
    },
    async listAgentInProgressTasks(agentIds) {
      if (!agentIds.length) return [];
      const placeholders = agentIds.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT t.id, t.number, t.title, t.project_id, t.status, t.assignee_id, t.updated_at, p.\`key\` AS project_key, p.name AS project_name, u.name AS assignee_name FROM tasks t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.assignee_id WHERE t.assignee_id IN (${placeholders}) AND t.status = 'IN_PROGRESS' ORDER BY t.assignee_id, t.updated_at DESC`).all(...agentIds);
      return rows.map(toReportingTask);
    },
    async listAgentLastActive(agentIds) {
      if (!agentIds.length) return [];
      const placeholders = agentIds.map(() => "?").join(",");
      const rows = await db.prepare(`SELECT user_id, MAX(last_used_at) AS last_active_at FROM api_tokens WHERE user_id IN (${placeholders}) AND revoked_at IS NULL GROUP BY user_id`).all(...agentIds);
      return rows.map((row): AgentLastActiveEntity => ({ agentId: text(row.user_id), lastActiveAt: nullableText(row.last_active_at) }));
    },
  };
}

function createDeliveryMonitorRepository(db: DatabasePort): DeliveryMonitorRepository {
  return {
    async health(now, pollIntervalMs) {
      const summary = await db.prepare("SELECT MAX(observed_at) AS lastSweepAt, COUNT(*) AS processedCount, MIN(CASE WHEN next_attempt_at > ? THEN next_attempt_at END) AS nextRetryAt FROM delivery_monitor_checkpoints").get<{ lastSweepAt: string | null; processedCount: number; nextRetryAt: string | null }>(now);
      const activeLeases = await db.prepare("SELECT run_id AS runId, owner_id AS ownerId, acquired_at AS acquiredAt, expires_at AS expiresAt FROM delivery_monitor_leases WHERE expires_at > ? ORDER BY expires_at ASC").all<DeliveryMonitorHealthEntity["activeLeases"][number] & Record<string, unknown>>(now);
      const failures = await db.prepare("SELECT run_id AS runId, task_id AS taskId, pull_request_url AS pullRequestUrl, retry_count AS retryCount, next_attempt_at AS nextRetryAt, observed_at AS lastObservedAt, last_state AS state, last_error AS errorCategory FROM delivery_monitor_checkpoints WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 100").all<DeliveryMonitorHealthEntity["failures"][number] & Record<string, unknown>>();
      const staleAt = summary?.lastSweepAt ? Date.parse(summary.lastSweepAt) + pollIntervalMs * 2 : null;
      return { status: !summary?.lastSweepAt ? "idle" : staleAt !== null && staleAt < Date.now() ? "stale" : "healthy", lastSweepAt: summary?.lastSweepAt ?? null, activeLeaseCount: activeLeases.length, processedCount: Number(summary?.processedCount ?? 0), nextRetryAt: summary?.nextRetryAt ?? null, failures, activeLeases };
    },
    async taskCheckpoint(taskId) { return (await db.prepare("SELECT run_id AS runId, task_id AS taskId, pull_request_url AS pullRequestUrl, etag, last_state AS state, observed_at AS lastObservedAt, retry_count AS retryCount, next_attempt_at AS nextRetryAt, last_error AS errorCategory FROM delivery_monitor_checkpoints WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1").get(taskId)) ?? null; },
  };
}

const emptyUsageTotals = (): AgentUsageTotals => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: 0, toolCalls: 0, runtimeMs: 0, retries: 0, forcedCycles: 0, runCount: 0, eventCount: 0 });
function toUsageTotals(row?: Row): AgentUsageTotals {
  if (!row) return emptyUsageTotals();
  const inputTokens = Number(row.inputTokens ?? 0);
  const outputTokens = Number(row.outputTokens ?? 0);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costMicros: Number(row.costMicros ?? 0), toolCalls: Number(row.toolCalls ?? 0), runtimeMs: Number(row.runtimeMs ?? 0), retries: Number(row.retries ?? 0), forcedCycles: Number(row.forcedCycles ?? 0), runCount: Number(row.runCount ?? 0), eventCount: Number(row.eventCount ?? 0) };
}
function createAgentUsageRepository(db: DatabasePort): AgentUsageRepository {
  const query = async (filters: Parameters<AgentUsageRepository["report"]>[0], group?: string): Promise<Row[]> => {
    const where: string[] = []; const values: unknown[] = [];
    for (const [field, value] of [["project_id", filters.projectId], ["phase_id", filters.phaseId], ["task_id", filters.taskId], ["run_id", filters.runId], ["provider", filters.provider], ["model", filters.model]] as const) if (value) { where.push(`${field} = ?`); values.push(value); }
    const key = group ? `${group} AS usageKey,` : "";
    return db.prepare(`SELECT ${key} COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(cost_micros),0) AS costMicros, COALESCE(SUM(tool_calls),0) AS toolCalls, COALESCE(SUM(runtime_ms),0) AS runtimeMs, COALESCE(SUM(is_retry),0) AS retries, COALESCE(SUM(is_forced_cycle),0) AS forcedCycles, COUNT(DISTINCT run_id) AS runCount, COUNT(*) AS eventCount FROM agent_usage_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${group ? ` GROUP BY ${group} ORDER BY ${group}` : ""}`).all(...values);
  };
  const breakdown = async (filters: Parameters<AgentUsageRepository["report"]>[0], group: string): Promise<AgentUsageBreakdown[]> => (await query(filters, group)).map((row) => ({ key: String(row.usageKey ?? "unassigned"), ...toUsageTotals(row) }));
  return {
    async append(input) {
      const inserted = await db.prepare("INSERT OR IGNORE INTO agent_usage_events (id,run_id,task_id,phase_id,project_id,event_id,provider,model,input_tokens,output_tokens,cost_micros,tool_calls,runtime_ms,is_retry,is_forced_cycle,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(input.id, input.runId, input.taskId, input.phaseId, input.projectId, input.eventId, input.provider, input.model, input.inputTokens, input.outputTokens, input.costMicros, input.toolCalls, input.runtimeMs, input.retry ? 1 : 0, input.forcedCycle ? 1 : 0, input.createdAt);
      if (inserted.changes > 0) return { event: input, created: true };
      const existing = await db.prepare("SELECT * FROM agent_usage_events WHERE run_id = ? AND event_id = ?").get(input.runId, input.eventId);
      if (!existing) throw new Error("Usage event conflict could not be recovered");
      return { event: toUsageEvent(existing), created: false };
    },
    async totals(filters) { return toUsageTotals((await query(filters))[0]); },
    async report(filters) {
      const [total, byRun, byTask, byPhase, byProject, byProvider, byModel] = await Promise.all([query(filters), breakdown(filters, "run_id"), breakdown(filters, "task_id"), breakdown(filters, "phase_id"), breakdown(filters, "project_id"), breakdown(filters, "provider"), breakdown(filters, "model")]);
      return { total: toUsageTotals(total[0]), byRun, byTask, byPhase, byProject, byProvider, byModel } satisfies AgentUsageReport;
    },
  };
}
function toUsageEvent(row: Row): AgentUsageEventEntity { return { id: text(row.id), runId: text(row.run_id), taskId: text(row.task_id), phaseId: nullableText(row.phase_id), projectId: text(row.project_id), eventId: text(row.event_id), provider: text(row.provider), model: text(row.model), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), costMicros: Number(row.cost_micros), toolCalls: Number(row.tool_calls), runtimeMs: Number(row.runtime_ms), retry: Boolean(row.is_retry), forcedCycle: Boolean(row.is_forced_cycle), createdAt: date(row.created_at) }; }
function toBudget(row: Row): AgentBudgetEntity { return { id: text(row.id), projectId: text(row.project_id), scope: row.scope_type as AgentBudgetEntity["scope"], scopeId: text(row.scope_id), action: row.action as AgentBudgetEntity["action"], limits: agentBudgetLimitsSchema.parse(typeof row.limits_json === "string" ? JSON.parse(row.limits_json) : row.limits_json), createdAt: date(row.created_at), updatedAt: date(row.updated_at) }; }
function createAgentBudgetRepository(db: DatabasePort): AgentBudgetRepository {
  return {
    async list(projectId) { return (await db.prepare("SELECT * FROM agent_budgets WHERE project_id = ? ORDER BY scope_type, scope_id").all(projectId)).map(toBudget); },
    async listApplicable(projectId, phaseId, taskId) { const rows = await db.prepare("SELECT * FROM agent_budgets WHERE project_id = ? AND ((scope_type = 'PROJECT' AND scope_id = ?) OR (scope_type = 'PHASE' AND scope_id = ?) OR (scope_type = 'TASK' AND scope_id = ?)) ORDER BY scope_type, scope_id").all(projectId, projectId, phaseId ?? "", taskId); return rows.map(toBudget); },
    async save(input) { const existing = await db.prepare("SELECT id FROM agent_budgets WHERE scope_type = ? AND scope_id = ?").get(input.scope, input.scopeId); const limits = JSON.stringify(input.limits); if (existing) await db.prepare("UPDATE agent_budgets SET project_id=?, action=?, limits_json=?, updated_at=? WHERE scope_type=? AND scope_id=?").run(input.projectId, input.action, limits, input.updatedAt, input.scope, input.scopeId); else await db.prepare("INSERT INTO agent_budgets (id,project_id,scope_type,scope_id,action,limits_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(input.id, input.projectId, input.scope, input.scopeId, input.action, limits, input.createdAt, input.updatedAt); return input; },
    async delete(projectId, scope, scopeId) { return (await db.prepare("DELETE FROM agent_budgets WHERE project_id = ? AND scope_type = ? AND scope_id = ?").run(projectId, scope, scopeId)).changes > 0; },
  };
}

function toAgentArtifact(row: Row): AgentArtifactEntity {
  const metadata = typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : row.metadata_json;
  const value = row.content;
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
  return { id: text(row.id), runId: text(row.run_id), taskId: text(row.task_id), projectId: text(row.project_id), headSha: text(row.head_sha), type: row.artifact_type as AgentArtifactType, name: text(row.name), mediaType: text(row.media_type), size: Number(row.file_size), contentHash: text(row.content_hash), metadata: metadata as AgentArtifactMetadata, content, createdById: text(row.created_by_id), createdAt: date(row.created_at) };
}
function createAgentArtifactRepository(db: DatabasePort): AgentArtifactRepository {
  return {
    async lockRun(runId) { await db.prepare(`SELECT id FROM agent_runs WHERE id = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(runId); },
    async countForRun(runId) { return Number((await db.prepare("SELECT COUNT(*) AS count FROM agent_artifacts WHERE run_id = ?").get(runId))?.count ?? 0); },
    async findDuplicate(runId, type, headSha, contentHash) { const row = await db.prepare("SELECT * FROM agent_artifacts WHERE run_id = ? AND artifact_type = ? AND head_sha = ? AND content_hash = ?").get(runId, type, headSha, contentHash); return row ? toAgentArtifact(row) : null; },
    async findById(id) { const row = await db.prepare("SELECT * FROM agent_artifacts WHERE id = ?").get(id); return row ? toAgentArtifact(row) : null; },
    async listForRun(runId) { return (await db.prepare("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at DESC, id DESC").all(runId)).map(toAgentArtifact); },
    async listForTask(taskId, headSha) { const rows = headSha ? await db.prepare("SELECT * FROM agent_artifacts WHERE task_id = ? AND head_sha = ? ORDER BY created_at DESC, id DESC").all(taskId, headSha) : await db.prepare("SELECT * FROM agent_artifacts WHERE task_id = ? ORDER BY created_at DESC, id DESC").all(taskId); return rows.map(toAgentArtifact); },
    async create(input) {
      await db.prepare("INSERT OR IGNORE INTO agent_artifacts (id,run_id,task_id,project_id,head_sha,artifact_type,name,media_type,file_size,content_hash,metadata_json,content,created_by_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(input.id, input.runId, input.taskId, input.projectId, input.headSha, input.type, input.name, input.mediaType, input.size, input.contentHash, JSON.stringify(input.metadata), input.content, input.createdById, input.createdAt);
      return (await this.findDuplicate(input.runId, input.type, input.headSha, input.contentHash)) ?? input;
    },
  };
}

function createSearchRepository(db: DatabasePort): SearchRepository {
  return { async searchAccessible(input) { const access = input.isAdmin ? "1 = 1" : "EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)"; const values: unknown[] = input.isAdmin ? [`%${input.query}%`, `%${input.query}%`] : [input.actorId, `%${input.query}%`, `%${input.query}%`]; const where = [access, "(t.title LIKE ? OR t.description LIKE ?)"]; const cursor = decodeCursor(input.page.cursor, 2); if (cursor) { where.push("(t.updated_at < ? OR (t.updated_at = ? AND t.id > ?))"); values.push(cursor[0], cursor[0], cursor[1]); } const rows = await db.prepare(`SELECT t.*, p.name AS project_name, p.\`key\` AS project_key, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC, t.id ASC LIMIT ${input.page.limit + 1}`).all(...values); const hydrated = await hydrateTasks(db, rows.map((row) => ({ ...toTask(row), projectName: text(row.project_name), projectKey: text(row.project_key), projectColor: text(row.project_color) }))); return toPage(hydrated, input.page, (task) => [task.updatedAt, task.id]); } };
}

export function createRepositories(db: DatabasePort): RepositorySet {
  return { users: createUserRepository(db), projects: createProjectRepository(db), memberships: createMembershipRepository(db), phases: createPhaseRepository(db), tasks: createTaskRepository(db), tags: createTagRepository(db), dependencies: createDependencyRepository(db), updates: createUpdateRepository(db), agentLogs: createAgentLogRepository(db), attachments: createAttachmentRepository(db), automations: createAutomationRepository(db), notifications: createNotificationRepository(db), activity: createActivityRepository(db), webhookDeliveries: createWebhookDeliveryRepository(db), reporting: createReportingRepository(db), tokens: createTokenRepository(db), search: createSearchRepository(db), runs: createAgentRunRepository(db), contextPacks: createAgentContextPackRepository(db), handoffs: createAgentHandoffRepository(db), plans: createAgentPlanRepository(db), gates: createTaskGateRepository(db), findings: createTaskFindingRepository(db), deliveryMonitor: createDeliveryMonitorRepository(db), agentUsage: createAgentUsageRepository(db), agentBudgets: createAgentBudgetRepository(db), artifacts: createAgentArtifactRepository(db) };
}
