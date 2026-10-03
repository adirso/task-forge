import type { ApiTokenMetadata } from "@taskforge/contracts";

export type RevokeTokenConfirmModalProps = {
  token: ApiTokenMetadata;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};
