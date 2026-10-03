import type { Project } from "@taskforge/contracts";

export type ProjectDeleteModalProps = {
  project: Project;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};
