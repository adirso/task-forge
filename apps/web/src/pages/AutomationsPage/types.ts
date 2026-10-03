import type { Phase, Project, User } from "@taskforge/contracts";

export interface AutomationsPageProps {
  project: Project | null;
  users: User[];
  phases?: Phase[];
}
