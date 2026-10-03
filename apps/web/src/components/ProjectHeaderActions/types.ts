import type { User } from "@taskforge/contracts";

export type ProjectHeaderActionsProps = {
  members: User[];
  canManageProject: boolean;
  onOpenMembers: () => void;
  onCopyLink: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
};
