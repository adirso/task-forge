import type { DragEvent } from "react";
import type { Attachment, Phase, Project, Tag, Task, TaskCreate, TaskPriority, TaskStatus, TaskType, User } from "@taskforge/contracts";

export type DetailsPanelProps = {
  task: Task | null;
  form: TaskCreate;
  initialStatus: TaskStatus;
  project: Project;
  currentUser: User;
  members: User[];
  phases: Phase[];
  availableTags: Tag[];
  tasks: Task[];
  attachments: Attachment[];
  draggingFiles: boolean;
  uploadingFiles: boolean;
  routingSkills: string;
  routing: boolean;
  set: <K extends keyof TaskCreate>(key: K, value: TaskCreate[K]) => void;
  setRoutingSkills: (value: string) => void;
  setDraggingFiles: (value: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onDownloadAttachment: (attachment: Attachment) => void;
  onRemoveAttachment: (attachment: Attachment) => void;
  onAutoRoute: () => void;
};
