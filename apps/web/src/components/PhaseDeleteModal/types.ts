import type { Phase } from "@taskforge/contracts";

export type PhaseDeleteDisposition =
  | { taskAction?: undefined; targetPhaseId?: undefined }
  | { taskAction: "move"; targetPhaseId: string }
  | { taskAction: "delete" };

export type PhaseDeleteModalProps = {
  phase: Phase;
  alternatives: Phase[];
  onClose: () => void;
  onConfirm: (disposition: PhaseDeleteDisposition) => Promise<void>;
};
