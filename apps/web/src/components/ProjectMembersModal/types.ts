import type { Project, User } from "@taskforge/contracts";

export type ProjectMembersModalProps = {
  project: Project;
  users: User[];
  currentUser: User;
  onClose: () => void;
  onChanged: (project: Project) => void;
};
