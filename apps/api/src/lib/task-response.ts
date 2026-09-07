import type { Task as ContractTask } from "@taskforge/contracts";
import type { TaskEntity } from "../application/models.js";

export function taskResponse(task: TaskEntity): ContractTask {
  const dependencies = (task.dependencies ?? []).map((dependency) => ({ ...dependency, projectKey: dependency.projectKey ?? "", isBlocking: dependency.isBlocking ?? (dependency.status !== "DONE" && dependency.status !== "CANCELLED") }));
  const blockers = dependencies.filter((dependency) => dependency.isBlocking);
  return {
    ...task,
    tags: task.tags ?? [],
    dependencies,
    blockedReason: task.blockedReason ?? (blockers.length ? `Waiting for dependencies: ${blockers.map((dependency) => `${dependency.projectKey}-${dependency.number} (${dependency.status})`).join(", ")}` : null),
    attachments: (task.attachments ?? []).map((attachment) => ({ id: attachment.id, taskId: attachment.taskId, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, uploadedBy: attachment.uploadedBy!, downloadUrl: `/api/attachments/${attachment.id}/download` })),
    updates: task.updates?.map((update) => ({ ...update, author: update.author! })),
  };
}
