import type { Project } from "@taskforge/contracts";

export type ProjectArchiveModalProps = {
  project: Project;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};
