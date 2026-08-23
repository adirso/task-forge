import { randomUUID } from "node:crypto";
import { TASK_STATUSES, type TaskStatus } from "@taskforge/contracts";
import type { ActivityEntity, AgentLastActiveEntity, ApiTokenEntity, AttachmentEntity, AutomationEntity, NotificationEntity, PhaseEntity, ProjectEntity, ReportingTaskEntity, TaskDependencyEntity, TaskEntity, TaskStatusCountEntity, TaskTagEntity, TaskUpdateEntity, UserEntity, WebhookDeliveryEntity } from "../application/models.js";
import type { ApiTokenRepository, AttachmentRepository, ActivityRepository, AutomationRepository, MembershipRepository, NotificationRepository, PhaseRepository, ProjectRepository, ReportingRepository, RepositorySet, SearchRepository, TaskDependencyRepository, TaskRepository, TaskTagRepository, TaskUpdateRepository, UserRepository, WebhookDeliveryRepository } from "../application/repositories.js";
import type { TaskFilters } from "../application/services.js";

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
  return { id: text(row.id), email: nullableText(row.email), name: text(row.name), kind: row.kind as UserEntity["kind"], role: row.role as UserEntity["role"], avatarUrl: nullableText(row.avatar_url), webhookUrl: nullableText(row.webhook_url), webhookSecretConfigured: Boolean(row.webhook_secret_ciphertext), createdAt: date(row.created_at) };
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
  return [...TASK_STATUSES];
}

function toProject(row: Row): ProjectEntity {
  const availableStatuses = configuredStatuses(row.available_statuses);
  const configuredDefault = String(row.default_status ?? "TODO") as TaskStatus;
  const defaultStatus = availableStatuses.includes(configuredDefault) ? configuredDefault : availableStatuses[0]!;
  return { id: text(row.id), key: text(row.key), name: text(row.name), description: text(row.description), repoUrl: nullableText(row.repo_url), color: text(row.color), sortOrder: Number(row.sort_order ?? 0), availableStatuses, defaultStatus, ownerId: text(row.owner_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}) };
}

function toPhase(row: Row): PhaseEntity {
  return { id: text(row.id), projectId: text(row.project_id), number: Number(row.number), goal: text(row.goal), isActive: Boolean(row.is_active), createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}) };
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
  return { taskId: text(row.task_id), dependsOnTaskId: text(row.depends_on_task_id), projectId: text(row.project_id), projectKey: nullableText(row.project_key) ?? undefined, number: Number(row.number), title: text(row.title), status: row.status as TaskDependencyEntity["status"] };
}

function toUpdate(row: Row): TaskUpdateEntity {
  return { id: text(row.id), taskId: text(row.task_id), authorId: text(row.author_id), body: text(row.body), createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
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

async function hydrateTask(db: DatabasePort, task: TaskEntity): Promise<TaskEntity> {
  const [tags, dependencies, assignee] = await Promise.all([
    db.prepare("SELECT * FROM tags JOIN task_tags ON task_tags.tag_id = tags.id WHERE task_tags.task_id = ? ORDER BY tags.name").all(task.id),
    db.prepare("SELECT td.task_id, td.depends_on_task_id, dep.project_id, p.`key` AS project_key, dep.number, dep.title, dep.status FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on_task_id JOIN projects p ON p.id = dep.project_id WHERE td.task_id = ? ORDER BY dep.number").all(task.id),
    task.assigneeId ? db.prepare("SELECT * FROM users WHERE id = ?").get(task.assigneeId) : Promise.resolve(undefined),
  ]);
  const attachments = await db.prepare("SELECT a.*, u.id AS uploaded_user_id, u.email AS uploaded_email, u.name AS uploaded_name, u.kind AS uploaded_kind, u.role AS uploaded_role, u.avatar_url AS uploaded_avatar_url, u.created_at AS uploaded_created_at FROM task_attachments a JOIN users u ON u.id = a.uploaded_by_id WHERE a.task_id = ? ORDER BY a.created_at DESC").all(task.id);
  return { ...task, tags: tags.map(toTag), dependencies: dependencies.map(toDependency), attachments: attachments.map((row) => ({ ...toAttachment(row), uploadedBy: { id: text(row.uploaded_user_id), email: nullableText(row.uploaded_email), name: text(row.uploaded_name), kind: row.uploaded_kind as UserEntity["kind"], role: row.uploaded_role as UserEntity["role"], avatarUrl: nullableText(row.uploaded_avatar_url), createdAt: date(row.uploaded_created_at) } })), assignee: assignee ? toUser(assignee) : null };
}

function toToken(row: Row): ApiTokenEntity {
  const ciphertext = nullableText(row.token_ciphertext ?? row.ciphertext);
  let permissions: string[] | null = null;
  if (row.permissions) { try { permissions = JSON.parse(String(row.permissions)); } catch { permissions = null; } }
  return { id: text(row.id), userId: text(row.user_id), name: text(row.name), prefix: text(row.token_prefix ?? row.prefix), expiresAt: nullableText(row.expires_at ?? row.expiresAt), lastUsedAt: nullableText(row.last_used_at ?? row.lastUsedAt), revokedAt: nullableText(row.revoked_at ?? row.revokedAt), createdAt: date(row.created_at ?? row.createdAt), revealable: Boolean(ciphertext), ciphertext, permissions };
}

function createUserRepository(db: DatabasePort): UserRepository {
  return {
    async findById(id) { const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); return row ? toUser(row) : null; },
    async findByEmail(email) { const row = await db.prepare("SELECT * FROM users WHERE email = ? AND kind = 'HUMAN'").get(email.toLowerCase()); return row ? { ...toUser(row), passwordHash: nullableText(row.password_hash) } : null; },
    async list() { return (await db.prepare("SELECT * FROM users ORDER BY kind, name").all()).map(toUser); },
    async saveProfile(id, input) { await db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(input.name, input.email.toLowerCase(), id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after update"); return toUser(row); },
    async updateAvatar(id, avatarUrl) { await db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after avatar update"); return toUser(row); },
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
    async create(input) { await db.prepare("INSERT INTO projects (id, `key`, name, description, repo_url, color, sort_order, available_statuses, default_status, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.key, input.name, input.description, input.repoUrl, input.color, input.sortOrder, JSON.stringify(input.availableStatuses), input.defaultStatus, input.ownerId, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const fields: string[] = []; const values: unknown[] = []; const columns: Record<string, string> = { name: "name", description: "description", repoUrl: "repo_url", color: "color", availableStatuses: "available_statuses", defaultStatus: "default_status" }; for (const [key, column] of Object.entries(columns)) if (key in input) { fields.push(`${column} = ?`); const value = input[key as keyof typeof input]; values.push(key === "availableStatuses" ? JSON.stringify(value) : value ?? null); } if (fields.length) { fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values); } const row = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id); if (!row) throw new Error("Project not found after update"); return toProject(row); },
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
    async list(projectId) { return (await db.prepare("SELECT p.*, COUNT(t.id) AS task_count FROM phases p LEFT JOIN tasks t ON t.phase_id = p.id WHERE p.project_id = ? GROUP BY p.id ORDER BY p.number DESC").all(projectId)).map(toPhase); },
    async findById(id) { const row = await db.prepare("SELECT * FROM phases WHERE id = ?").get(id); return row ? toPhase(row) : null; },
    async findActive(projectId) { const row = await db.prepare("SELECT * FROM phases WHERE project_id = ? AND is_active = 1").get(projectId); return row ? toPhase(row) : null; },
    async deactivateOthers(projectId, phaseId) { await db.prepare("UPDATE phases SET is_active = 0, updated_at = ? WHERE project_id = ? AND (? IS NULL OR id != ?)").run(new Date().toISOString(), projectId, phaseId ?? null, phaseId ?? null); },
    async create(input) { await db.prepare("INSERT INTO phases (id, project_id, number, goal, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.id, input.projectId, input.number, input.goal, input.isActive ? 1 : 0, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const fields: string[] = []; const values: unknown[] = []; if (input.number !== undefined) { fields.push("number = ?"); values.push(input.number); } if (input.goal !== undefined) { fields.push("goal = ?"); values.push(input.goal); } if (input.isActive !== undefined) { fields.push("is_active = ?"); values.push(input.isActive ? 1 : 0); } fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE phases SET ${fields.join(", ")} WHERE id = ?`).run(...values); const row = await db.prepare("SELECT * FROM phases WHERE id = ?").get(id); if (!row) throw new Error("Phase not found after update"); return toPhase(row); },
    async delete(id) { await db.prepare("UPDATE tasks SET phase_id = NULL WHERE phase_id = ?").run(id); await db.prepare("DELETE FROM phases WHERE id = ?").run(id); },
  };
}

function createTaskRepository(db: DatabasePort): TaskRepository {
  return {
    async findById(id) { const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); return row ? hydrateTask(db, toTask(row)) : null; },
    async findByProjectNumber(projectId, number) { const row = await db.prepare("SELECT * FROM tasks WHERE project_id = ? AND number = ?").get(projectId, number); return row ? hydrateTask(db, toTask(row)) : null; },
    async unassignForProjectMember(projectId, userId) { await db.prepare("UPDATE tasks SET assignee_id = NULL, updated_at = ? WHERE project_id = ? AND assignee_id = ?").run(new Date().toISOString(), projectId, userId); },
    async listByProject(projectId, filters = {}) { const where = ["project_id = ?"]; const values: unknown[] = [projectId]; const filterMap: Record<string, string> = { status: "status", assigneeId: "assignee_id", priority: "priority", type: "type", phaseId: "phase_id" }; for (const [key, column] of Object.entries(filterMap)) if (filters[key as keyof TaskFilters] !== undefined) { where.push(`${column} = ?`); values.push(filters[key as keyof TaskFilters]); } if (filters.tag) { where.push("EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = tasks.id AND tg.name = ? COLLATE NOCASE)"); values.push(filters.tag); } if (filters.minPoints !== undefined) { where.push("estimate_points >= ?"); values.push(filters.minPoints); } if (filters.maxPoints !== undefined) { where.push("estimate_points <= ?"); values.push(filters.maxPoints); } if (filters.query) { where.push("(title LIKE ? OR description LIKE ?)"); values.push(`%${filters.query}%`, `%${filters.query}%`); } const rows = await db.prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY status, position, created_at DESC`).all(...values); return Promise.all(rows.map((row) => hydrateTask(db, toTask(row)))); },
    async allocateNumber(projectId, status) { const project = await db.prepare(`SELECT next_task_number FROM projects WHERE id = ?${db.dialect === "mysql" ? " FOR UPDATE" : ""}`).get(projectId); if (!project) throw new Error("Project not found"); const positionRow = await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM tasks WHERE project_id = ? AND status = ?").get(projectId, status); const position = Number(positionRow?.next ?? 0); await db.prepare("UPDATE projects SET next_task_number = next_task_number + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), projectId); return { number: Number(project.next_task_number), position }; },
    async create(input) { await db.prepare(`INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id, parent_id, branch, due_date, estimate_points, phase_id, pull_request_url, pull_request_title, pull_request_state, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, input.projectId, input.number, input.title, input.description, input.definitionOfDone, input.status, input.priority, input.type, input.assigneeId, input.creatorId, input.parentId, input.branch, input.dueDate, input.estimatePoints, input.phaseId, input.pullRequestUrl, input.pullRequestTitle, input.pullRequestState, input.position, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const columns: Record<string, string> = { title: "title", description: "description", definitionOfDone: "definition_of_done", status: "status", priority: "priority", type: "type", assigneeId: "assignee_id", parentId: "parent_id", branch: "branch", dueDate: "due_date", estimatePoints: "estimate_points", phaseId: "phase_id", pullRequestUrl: "pull_request_url", pullRequestTitle: "pull_request_title", pullRequestState: "pull_request_state", position: "position" }; const fields: string[] = []; const values: unknown[] = []; for (const [key, column] of Object.entries(columns)) if (key in input) { fields.push(`${column} = ?`); values.push(input[key as keyof typeof input] ?? null); } if (fields.length) { fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values); } const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); if (!row) throw new Error("Task not found after update"); return hydrateTask(db, toTask(row)); },
    async delete(id) { await db.prepare("DELETE FROM tasks WHERE id = ?").run(id); },
    async listForAssignee(assigneeId, status) {
      const where = ["t.assignee_id = ?"];
      const params: unknown[] = [assigneeId];
      if (status) { where.push("t.status = ?"); params.push(status); }
      const rows = await db.prepare(`SELECT t.*, p.name AS project_name, p.\`key\` AS project_key FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${where.join(" AND ")} ORDER BY t.updated_at DESC`).all(...params);
      return rows.map((row) => ({ ...toTask(row), projectName: text(row.project_name), projectKey: text(row.project_key) }));
    },
    async listUsedStatuses(projectId) { return (await db.prepare("SELECT DISTINCT status FROM tasks WHERE project_id = ?").all(projectId)).map((row) => row.status as TaskStatus); },
    async claimNext(projectId, claimantId, workflow, options = {}) {
      if (!workflow.sourceStatuses.length) return null;
      const sourcePlaceholders = workflow.sourceStatuses.map(() => "?").join(", ");
      const where = ["project_id = ?", `status IN (${sourcePlaceholders})`, "assignee_id IS NULL"];
      const params: unknown[] = [projectId, ...workflow.sourceStatuses];
      if (options.phaseId !== undefined && options.phaseId !== null) { where.push("phase_id = ?"); params.push(options.phaseId); }
      if (options.priority) { where.push("priority = ?"); params.push(options.priority); }
      const orderExpr = "CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, position";
      const candidate = await db.prepare(`SELECT id FROM tasks WHERE ${where.join(" AND ")} ORDER BY ${orderExpr} LIMIT 1`).get(...params);
      if (!candidate) return null;
      const now = new Date().toISOString();
      const result = await db.prepare(`UPDATE tasks SET assignee_id = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status IN (${sourcePlaceholders}) AND assignee_id IS NULL`).run(claimantId, workflow.targetStatus, now, candidate.id, projectId, ...workflow.sourceStatuses);
      if (!result.changes) return null;
      const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").get(candidate.id);
      return row ? hydrateTask(db, toTask(row)) : null;
    },
  };
}

function createTagRepository(db: DatabasePort): TaskTagRepository {
  return { async listForTask(taskId) { return (await db.prepare("SELECT * FROM tags JOIN task_tags ON task_tags.tag_id = tags.id WHERE task_tags.task_id = ? ORDER BY tags.name").all(taskId)).map(toTag); }, async listForProject(projectId) { return (await db.prepare("SELECT tags.*, COUNT(task_tags.task_id) AS task_count FROM tags LEFT JOIN task_tags ON task_tags.tag_id = tags.id WHERE tags.project_id = ? GROUP BY tags.id ORDER BY tags.name").all(projectId)).map((row) => ({ ...toTag(row), taskCount: Number(row.task_count) })); }, async replaceForTask(taskId, projectId, names, createdAt) { await db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId); for (const name of [...new Set(names)]) { const existing = await db.prepare("SELECT id FROM tags WHERE project_id = ? AND name = ?").get(projectId, name); const id = existing?.id ? text(existing.id) : randomUUID(); if (!existing) await db.prepare("INSERT INTO tags (id, project_id, name, created_at) VALUES (?, ?, ?, ?)").run(id, projectId, name, createdAt); await db.prepare("INSERT INTO task_tags (task_id, tag_id, created_at) VALUES (?, ?, ?)").run(taskId, id, createdAt); } } };
}

function createDependencyRepository(db: DatabasePort): TaskDependencyRepository {
  return { async listForTask(taskId) { return (await db.prepare("SELECT td.task_id, td.depends_on_task_id, dep.project_id, p.`key` AS project_key, dep.number, dep.title, dep.status FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on_task_id JOIN projects p ON p.id = dep.project_id WHERE td.task_id = ? ORDER BY dep.number").all(taskId)).map(toDependency); }, async replaceForTask(taskId, dependencyIds, createdAt) { await db.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId); for (const dependencyId of [...new Set(dependencyIds)]) await db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id, created_at) VALUES (?, ?, ?)").run(taskId, dependencyId, createdAt); } };
}

function createUpdateRepository(db: DatabasePort): TaskUpdateRepository {
  return { async listForTask(taskId) { return (await db.prepare("SELECT * FROM task_updates WHERE task_id = ? ORDER BY created_at DESC").all(taskId)).map(toUpdate); }, async create(input) { await db.prepare("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(input.id, input.taskId, input.authorId, input.body, input.createdAt, input.updatedAt); return input; } };
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
  return { async notify(input) { await db.prepare("INSERT INTO notifications (id, user_id, project_id, task_id, type, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), input.userId, input.projectId ?? null, input.taskId ?? null, input.type, input.title, input.message, new Date().toISOString()); }, async listForUser(userId) { return (await db.prepare(`${select} WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50`).all(userId)).map(toNotification); }, async markRead(userId, id) { const result = await db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?").run(new Date().toISOString(), id, userId); if (!result.changes) throw new Error("Notification not found after read"); const row = await db.prepare(`${select} WHERE n.id = ? AND n.user_id = ?`).get(id, userId); if (!row) throw new Error("Notification not found after read"); return toNotification(row); }, async markAllRead(userId) { return (await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(new Date().toISOString(), userId)).changes; } };
}

function createTokenRepository(db: DatabasePort): ApiTokenRepository {
  return { async create(input) { await db.prepare("INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, token_ciphertext, permissions, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.userId, input.name, input.prefix, input.hash, input.ciphertext, input.permissions ? JSON.stringify(input.permissions) : null, input.expiresAt, input.createdAt); }, async listForUser(userId) { return (await db.prepare("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId)).map((row) => { const token = toToken(row); const { ciphertext: _ciphertext, ...metadata } = token; return metadata; }); }, async findById(id) { const row = await db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id); return row ? { ...toToken(row), userId: String(row.user_id), ciphertext: nullableText(row.token_ciphertext) } : null; }, async revoke(id) { await db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), id); } };
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
      const limit = queryLimit(filters.limit ?? 50);
      const rows = await db.prepare(`SELECT a.*, u.name AS actor_name, u.kind AS actor_kind, u.avatar_url AS actor_avatar_url, p.\`key\` AS project_key, t.number AS task_number FROM activity a JOIN users u ON u.id = a.actor_id JOIN projects p ON p.id = a.project_id LEFT JOIN tasks t ON t.id = a.task_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC LIMIT ${limit}`).all(...params);
      return rows.map((row) => {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(String(row.metadata ?? "{}")); } catch { /* empty */ }
        return { id: text(row.id), projectId: text(row.project_id), projectKey: text(row.project_key), taskId: nullableText(row.task_id), taskNumber: row.task_number == null ? null : Number(row.task_number), actorId: text(row.actor_id), actorName: text(row.actor_name), actorKind: row.actor_kind as UserEntity["kind"], actorAvatarUrl: nullableText(row.actor_avatar_url), action: text(row.action), metadata, createdAt: date(row.created_at) };
      });
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

function createSearchRepository(db: DatabasePort): SearchRepository {
  return { async searchAccessible(input) { const access = input.isAdmin ? "1 = 1" : "EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)"; const values: unknown[] = input.isAdmin ? [`%${input.query}%`, `%${input.query}%`] : [input.actorId, `%${input.query}%`, `%${input.query}%`]; const rows = await db.prepare(`SELECT t.*, p.name AS project_name, p.\`key\` AS project_key, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${access} AND (t.title LIKE ? OR t.description LIKE ?) ORDER BY t.updated_at DESC`).all(...values); return Promise.all(rows.map(async (row) => ({ ...(await hydrateTask(db, toTask(row))), projectName: text(row.project_name), projectKey: text(row.project_key), projectColor: text(row.project_color) }))); } };
}

export function createRepositories(db: DatabasePort): RepositorySet {
  return { users: createUserRepository(db), projects: createProjectRepository(db), memberships: createMembershipRepository(db), phases: createPhaseRepository(db), tasks: createTaskRepository(db), tags: createTagRepository(db), dependencies: createDependencyRepository(db), updates: createUpdateRepository(db), attachments: createAttachmentRepository(db), automations: createAutomationRepository(db), notifications: createNotificationRepository(db), activity: createActivityRepository(db), webhookDeliveries: createWebhookDeliveryRepository(db), reporting: createReportingRepository(db), tokens: createTokenRepository(db), search: createSearchRepository(db) };
}
