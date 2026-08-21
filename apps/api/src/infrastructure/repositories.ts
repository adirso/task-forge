import { randomUUID } from "node:crypto";
import type { ActivityEntity, ApiTokenEntity, AttachmentEntity, AutomationEntity, NotificationEntity, PhaseEntity, ProjectEntity, ProjectStatusEntity, TaskDependencyEntity, TaskEntity, TaskTagEntity, TaskUpdateEntity, UserEntity, WorkflowTemplateStatusEntity } from "../application/models.js";
import type { ApiTokenRepository, AttachmentRepository, ActivityRepository, AutomationRepository, MembershipRepository, NotificationRepository, PhaseRepository, ProjectRepository, RepositorySet, SearchRepository, TaskDependencyRepository, TaskRepository, TaskTagRepository, TaskUpdateRepository, UserRepository, WorkflowRepository } from "../application/repositories.js";
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

function toUser(row: Row): UserEntity {
  return { id: text(row.id), email: nullableText(row.email), name: text(row.name), kind: row.kind as UserEntity["kind"], role: row.role as UserEntity["role"], avatarUrl: nullableText(row.avatar_url), webhookUrl: nullableText(row.webhook_url), createdAt: date(row.created_at) };
}

function toProject(row: Row): ProjectEntity {
  return { id: text(row.id), key: text(row.key), name: text(row.name), description: text(row.description), repoUrl: nullableText(row.repo_url), color: text(row.color), sortOrder: Number(row.sort_order ?? 0), ownerId: text(row.owner_id), createdAt: date(row.created_at), updatedAt: date(row.updated_at), ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}) };
}

function toWorkflowTemplateStatus(row: Row): WorkflowTemplateStatusEntity {
  return {
    id: text(row.id), templateId: text(row.template_id), key: text(row.key), label: text(row.label), color: text(row.color),
    category: row.category as WorkflowTemplateStatusEntity["category"], position: Number(row.position), isInitial: Boolean(row.is_initial),
    isClaimable: Boolean(row.is_claimable), isClaimTarget: Boolean(row.is_claim_target), triggersReview: Boolean(row.triggers_review),
    tracksStaleness: Boolean(row.tracks_staleness), satisfiesDependencies: Boolean(row.satisfies_dependencies), archivedAt: nullableText(row.archived_at),
  };
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
    async updateWebhookUrl(id, webhookUrl) { await db.prepare("UPDATE users SET webhook_url = ? WHERE id = ?").run(webhookUrl, id); const row = await db.prepare("SELECT * FROM users WHERE id = ?").get(id); if (!row) throw new Error("User not found after webhook update"); return toUser(row); },
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
    async create(input) { await db.prepare("INSERT INTO projects (id, `key`, name, description, repo_url, color, sort_order, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.key, input.name, input.description, input.repoUrl, input.color, input.sortOrder, input.ownerId, input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const fields: string[] = []; const values: unknown[] = []; const columns: Record<string, string> = { name: "name", description: "description", repoUrl: "repo_url", color: "color" }; for (const [key, column] of Object.entries(columns)) if (key in input) { fields.push(`${column} = ?`); values.push(input[key as keyof typeof input] ?? null); } if (fields.length) { fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values); } const row = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id); if (!row) throw new Error("Project not found after update"); return toProject(row); },
    async delete(id) { await db.prepare("DELETE FROM projects WHERE id = ?").run(id); },
  };
}

function createWorkflowRepository(db: DatabasePort): WorkflowRepository {
  return {
    async listSystemDefaultStatuses() {
      const rows = await db.prepare("SELECT s.* FROM workflow_template_statuses s JOIN workflow_templates t ON t.id = s.template_id WHERE t.is_system_default = 1 AND s.archived_at IS NULL ORDER BY s.position").all();
      return rows.map(toWorkflowTemplateStatus);
    },
    async createProjectStatuses(statuses: ProjectStatusEntity[]) {
      const insert = db.prepare("INSERT INTO project_statuses (id, project_id, `key`, label, color, category, position, is_initial, is_claimable, is_claim_target, triggers_review, tracks_staleness, satisfies_dependencies, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const status of statuses) await insert.run(status.id, status.projectId, status.key, status.label, status.color, status.category, status.position, status.isInitial ? 1 : 0, status.isClaimable ? 1 : 0, status.isClaimTarget ? 1 : 0, status.triggersReview ? 1 : 0, status.tracksStaleness ? 1 : 0, status.satisfiesDependencies ? 1 : 0, status.archivedAt, status.createdAt, status.updatedAt);
    },
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
    async claimNext(projectId, claimantId, options = {}) {
      const where = ["project_id = ?", "status IN ('BACKLOG', 'TODO')", "assignee_id IS NULL"];
      const params: unknown[] = [projectId];
      if (options.phaseId !== undefined && options.phaseId !== null) { where.push("phase_id = ?"); params.push(options.phaseId); }
      if (options.priority) { where.push("priority = ?"); params.push(options.priority); }
      const orderExpr = "CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, position";
      const candidate = await db.prepare(`SELECT id FROM tasks WHERE ${where.join(" AND ")} ORDER BY ${orderExpr} LIMIT 1`).get(...params);
      if (!candidate) return null;
      const now = new Date().toISOString();
      const result = await db.prepare("UPDATE tasks SET assignee_id = ?, status = 'IN_PROGRESS', updated_at = ? WHERE id = ? AND status IN ('BACKLOG', 'TODO') AND assignee_id IS NULL").run(claimantId, now, candidate.id);
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
    async create(input) { await db.prepare("INSERT INTO automations (id, project_id, name, enabled, trigger, actor_type, actor_id, service, conditions, actions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.projectId, input.name, input.enabled ? 1 : 0, input.trigger, input.actorType, input.actorId, input.service, JSON.stringify(input.conditions), JSON.stringify(input.actions), input.createdAt, input.updatedAt); return input; },
    async update(id, input) { const map: Record<string, string> = { name: "name", enabled: "enabled", trigger: "trigger", actorType: "actor_type", actorId: "actor_id", service: "service", conditions: "conditions", actions: "actions" }; const fields: string[] = []; const values: unknown[] = []; for (const [key, column] of Object.entries(map)) if (key in input) { fields.push(`${column} = ?`); const value = input[key as keyof typeof input]; values.push(key === "enabled" ? (value ? 1 : 0) : key === "conditions" || key === "actions" ? JSON.stringify(value) : value ?? null); } fields.push("updated_at = ?"); values.push(new Date().toISOString(), id); await db.prepare(`UPDATE automations SET ${fields.join(", ")} WHERE id = ?`).run(...values); const row = await db.prepare("SELECT * FROM automations WHERE id = ?").get(id); if (!row) throw new Error("Automation not found after update"); return toAutomation(row); },
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
      const limit = filters.limit ?? 50;
      const rows = await db.prepare(`SELECT a.*, u.name AS actor_name, u.kind AS actor_kind, u.avatar_url AS actor_avatar_url, p.\`key\` AS project_key, t.number AS task_number FROM activity a JOIN users u ON u.id = a.actor_id JOIN projects p ON p.id = a.project_id LEFT JOIN tasks t ON t.id = a.task_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC LIMIT ?`).all(...params, limit);
      return rows.map((row) => {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(String(row.metadata ?? "{}")); } catch { /* empty */ }
        return { id: text(row.id), projectId: text(row.project_id), projectKey: text(row.project_key), taskId: nullableText(row.task_id), taskNumber: row.task_number == null ? null : Number(row.task_number), actorId: text(row.actor_id), actorName: text(row.actor_name), actorKind: row.actor_kind as UserEntity["kind"], actorAvatarUrl: nullableText(row.actor_avatar_url), action: text(row.action), metadata, createdAt: date(row.created_at) };
      });
    },
  };
}

function createSearchRepository(db: DatabasePort): SearchRepository {
  return { async searchAccessible(input) { const access = input.isAdmin ? "1 = 1" : "EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)"; const values: unknown[] = input.isAdmin ? [`%${input.query}%`, `%${input.query}%`] : [input.actorId, `%${input.query}%`, `%${input.query}%`]; const rows = await db.prepare(`SELECT t.*, p.name AS project_name, p.\`key\` AS project_key, p.color AS project_color FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${access} AND (t.title LIKE ? OR t.description LIKE ?) ORDER BY t.updated_at DESC`).all(...values); return Promise.all(rows.map(async (row) => ({ ...(await hydrateTask(db, toTask(row))), projectName: text(row.project_name), projectKey: text(row.project_key), projectColor: text(row.project_color) }))); } };
}

export function createRepositories(db: DatabasePort): RepositorySet {
  return { users: createUserRepository(db), projects: createProjectRepository(db), workflows: createWorkflowRepository(db), memberships: createMembershipRepository(db), phases: createPhaseRepository(db), tasks: createTaskRepository(db), tags: createTagRepository(db), dependencies: createDependencyRepository(db), updates: createUpdateRepository(db), attachments: createAttachmentRepository(db), automations: createAutomationRepository(db), notifications: createNotificationRepository(db), activity: createActivityRepository(db), tokens: createTokenRepository(db), search: createSearchRepository(db) };
}
