import type { Project, User } from "@taskforge/contracts";

export type SidebarProps = {
  projects: Project[];
  currentId: string | null;
  user: User;
  unreadCount: number;
  settingsActive: boolean;
  dashboardActive: boolean;
  onSearch: () => void;
  onNotifications: () => void;
  onSettings: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onLogout: () => void;
  onReorder: (projectIds: string[]) => void;
  onHome: () => void;
  className?: string;
  onNavigate?: () => void;
};
