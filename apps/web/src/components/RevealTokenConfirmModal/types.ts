import type { ApiTokenMetadata } from "@taskforge/contracts";

export type RevealTokenConfirmModalProps = {
  token: ApiTokenMetadata;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};
