import type { Notification } from "@taskforge/contracts";

export type NotificationPanelProps = {
  notifications: Notification[];
  onClose: () => void;
  onOpen: (notification: Notification) => void;
  onReadAll: () => void;
};
