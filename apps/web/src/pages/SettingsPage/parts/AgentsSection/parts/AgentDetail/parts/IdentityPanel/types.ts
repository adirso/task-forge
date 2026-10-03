import type { User } from "@taskforge/contracts";

export type IdentityPanelProps = {
  agent: User;
  avatarUploading: boolean;
  onUpdateAgentAvatar: (file: File) => void | Promise<void>;
  onRemoveAgentAvatar: () => void | Promise<void>;
};
