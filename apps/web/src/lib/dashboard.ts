const STORAGE_KEY = "taskforge_dashboard";

export type WidgetType =
  | "project_status"
  | "project_progress"
  | "my_tasks"
  | "stuck_tasks"
  | "activity"
  | "agent_ops";

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
}

export interface DashboardLayout {
  widgets: WidgetInstance[];
}

const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "default_project_status", type: "project_status", x: 24, y: 24 },
    { id: "default_my_tasks", type: "my_tasks", x: 420, y: 24 },
  ],
};

export function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "widgets" in parsed && Array.isArray((parsed as DashboardLayout).widgets)) {
      return parsed as DashboardLayout;
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_LAYOUT;
}

export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore storage errors
  }
}

export function makeWidgetId(): string {
  return `w_${Math.random().toString(36).slice(2, 9)}`;
}

export const WIDGET_LABELS: Record<WidgetType, string> = {
  project_status: "Project status",
  project_progress: "Project progress",
  my_tasks: "My tasks",
  stuck_tasks: "Stuck tasks",
  activity: "Recent activity",
  agent_ops: "Agent ops",
};

export const WIDGET_DESCRIPTIONS: Record<WidgetType, string> = {
  project_status: "TODO / IN_PROGRESS / DONE counts per project",
  project_progress: "Completion percentage bars per project",
  my_tasks: "Open tasks assigned to you across all projects",
  stuck_tasks: "IN_PROGRESS tasks not updated in 4+ hours",
  activity: "Latest events across all your projects",
  agent_ops: "Agent fleet overview — workload and health",
};
