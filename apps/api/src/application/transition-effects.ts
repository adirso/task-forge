import { randomUUID } from "node:crypto";
import type { TaskStatus } from "@taskforge/contracts";
import type { RequestContext } from "./context.js";
import type { TaskEntity } from "./models.js";
import type { RepositorySet } from "./repositories.js";

export async function enqueueTaskStatusWebhook(
  repositories: RepositorySet,
  task: TaskEntity,
  previousStatus: TaskStatus,
  context: RequestContext,
  runId: string | null = null,
  newId: () => string = randomUUID,
  now = () => new Date().toISOString(),
) {
  if (!task.assigneeId) return;
  const assignee = await repositories.users.findById(task.assigneeId);
  if (!assignee || assignee.kind !== "AGENT" || !assignee.webhookUrl) return;
  const project = await repositories.projects.findById(task.projectId);
  const id = newId();
  const timestamp = now();
  const payload = {
    id, event: "task.status_changed",
    task: { id: task.id, number: task.number, title: task.title, description: task.description, definitionOfDone: task.definitionOfDone, status: task.status, priority: task.priority, type: task.type, branch: task.branch, projectId: task.projectId, projectKey: project?.key, projectName: project?.name, assigneeId: task.assigneeId },
    previousStatus, runId, changedBy: { id: context.actor.userId, name: context.actor.name }, timestamp,
  };
  await repositories.webhookDeliveries.create({ id, agentId: assignee.id, taskId: task.id, eventType: "task.status_changed", payload: JSON.stringify(payload), status: "PENDING", attemptCount: 0, nextAttemptAt: timestamp, lockedUntil: null, lastAttemptAt: null, deliveredAt: null, failedAt: null, lastError: null, httpStatus: null, createdAt: timestamp, updatedAt: timestamp });
}
