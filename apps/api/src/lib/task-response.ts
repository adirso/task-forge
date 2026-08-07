import type { Task as ContractTask } from "@taskforge/contracts";
import type { TaskEntity } from "../application/models.js";

export function taskResponse(task: TaskEntity): ContractTask {
  return {
    ...task,
    tags: task.tags ?? [],
    dependencies: (task.dependencies ?? []).map((dependency) => ({ ...dependency, projectKey: dependency.projectKey ?? "", isBlocking: dependency.isBlocking ?? dependency.status !== "DONE" })),
    attachments: (task.attachments ?? []).map((attachment) => ({ id: attachment.id, taskId: attachment.taskId, fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size, createdAt: attachment.createdAt, uploadedBy: attachment.uploadedBy!, downloadUrl: `/api/attachments/${attachment.id}/download` })),
  };
}
