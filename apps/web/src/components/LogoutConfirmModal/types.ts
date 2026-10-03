import type { User } from "@taskforge/contracts";

export type LogoutConfirmModalProps = {
  user: User;
  onClose: () => void;
  onConfirm: () => void;
};
