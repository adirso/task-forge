import { DEFAULT_PROJECT_STATUSES, TASK_STATUSES, type Project, type Tag, type Task, type TaskDependency, type User } from "@taskforge/contracts";
import { db } from "../db/database.js";

type Row = Record<string, unknown>;

export function toUser(row: Row, prefix = ""): User {
  return {
    id: String(row[`${prefix}id`]),
    email: (row[`${prefix}email`] as string | null) ?? null,
    name: String(row[`${prefix}name`]),
    kind: row[`${prefix}kind`] as User["kind"],
    role: row[`${prefix}role`] as User["role"],
    avatarUrl: (row[`${prefix}avatar_url`] as string | null) ?? null,
    createdAt: String(row[`${prefix}created_at`]),
  };
}

export function toProject(row: Row): Project {
  let availableStatuses: Project["availableStatuses"] = [...DEFAULT_PROJECT_STATUSES];
  try {
    const parsed = JSON.parse(String(row.available_statuses ?? "[]"));
    const selected = TASK_STATUSES.filter((status) => Array.isArray(parsed) && parsed.includes(status));
    if (selected.length) availableStatuses = selected;
  } catch { /* Legacy projects use the shipped default subset. */ }
  const configuredDefault = String(row.default_status ?? "TODO") as Project["defaultStatus"];
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description),
    repoUrl: (row.repo_url as string | null) ?? null,
    color: String(row.color),
    sortOrder: Number(row.sort_order ?? 0),
    availableStatuses,
    defaultStatus: availableStatuses.includes(configuredDefault) ? configuredDefault : availableStatuses[0]!,
    ownerId: String(row.owner_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.task_count !== undefined ? { taskCount: Number(row.task_count) } : {}),
  };
}

export async function toTask(row: Row): Promise<Task> {
  const tags = await db.prepare(`SELECT tags.* FROM tags JOIN task_tags ON task_tags.tag_id = tags.id
    WHERE task_tags.task_id = ? ORDER BY tags.name`).all(String(row.id)) as Row[];
  const dependencies = await db.prepare(`SELECT td.task_id, td.depends_on_task_id, dep.project_id, p.\`key\` AS project_key,
      dep.number, dep.title, dep.status
    FROM task_dependencies td
    JOIN tasks dep ON dep.id = td.depends_on_task_id
    JOIN projects p ON p.id = dep.project_id
    WHERE td.task_id = ? ORDER BY dep.number`).all(String(row.id)) as Row[];
  const task: Task = {
    id: String(row.id),
    projectId: String(row.project_id),
    number: Number(row.number),
    title: String(row.title),
    description: String(row.description),
    definitionOfDone: String(row.definition_of_done),
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    type: (row.type as Task["type"]) ?? "FEATURE",
    assigneeId: (row.assignee_id as string | null) ?? null,
    creatorId: String(row.creator_id),
    parentId: (row.parent_id as string | null) ?? null,
    branch: (row.branch as string | null) ?? null,
    dueDate: (row.due_date as string | null) ?? null,
    estimatePoints: row.estimate_points === null || row.estimate_points === undefined ? null : Number(row.estimate_points),
    phaseId: (row.phase_id as string | null) ?? null,
    pullRequestUrl: (row.pull_request_url as string | null) ?? null,
    pullRequestTitle: (row.pull_request_title as string | null) ?? null,
    pullRequestState: (row.pull_request_state as Task["pullRequestState"]) ?? null,
    position: Number(row.position),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    tags: tags.map((tag): Tag => ({ id: String(tag.id), projectId: String(tag.project_id), name: String(tag.name), createdAt: String(tag.created_at) })),
    dependencies: dependencies.map((dependency): TaskDependency => ({
      taskId: String(dependency.task_id), dependsOnTaskId: String(dependency.depends_on_task_id), projectId: String(dependency.project_id),
      projectKey: String(dependency.project_key), number: Number(dependency.number), title: String(dependency.title),
      status: dependency.status as Task["status"], isBlocking: dependency.status !== "DONE" && dependency.status !== "CANCELLED",
    })),
    attachments: [],
  };
  if (row.assignee_name) {
    task.assignee = {
      id: String(row.assignee_id),
      email: (row.assignee_email as string | null) ?? null,
      name: String(row.assignee_name),
      kind: row.assignee_kind as User["kind"],
      role: row.assignee_role as User["role"],
      avatarUrl: (row.assignee_avatar_url as string | null) ?? null,
      createdAt: String(row.assignee_created_at),
    };
  } else {
    task.assignee = null;
  }
  return task;
}
