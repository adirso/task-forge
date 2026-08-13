const STORAGE_KEY = "taskforge_dashboard";

export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 72;
export const GRID_MARGIN: [number, number] = [16, 16];
export const GRID_PADDING: [number, number] = [20, 20];

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
  w: number;
  h: number;
}

export interface DashboardLayout {
  version: 2;
  widgets: WidgetInstance[];
}

export const DEFAULT_WIDGET_SIZE: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  project_status: { w: 6, h: 4, minW: 3, minH: 2 },
  project_progress: { w: 6, h: 4, minW: 3, minH: 2 },
  my_tasks: { w: 6, h: 5, minW: 3, minH: 3 },
  stuck_tasks: { w: 6, h: 4, minW: 3, minH: 3 },
  activity: { w: 4, h: 5, minW: 3, minH: 3 },
  agent_ops: { w: 8, h: 4, minW: 4, minH: 3 },
};

const DEFAULT_TYPES: WidgetType[] = ["project_status", "my_tasks", "stuck_tasks", "activity"];

export function defaultLayout(isAdmin = false): DashboardLayout {
  const types: WidgetType[] = isAdmin ? [...DEFAULT_TYPES, "agent_ops"] : DEFAULT_TYPES;
  const widgets: WidgetInstance[] = [];
  for (const type of types) {
    const size = DEFAULT_WIDGET_SIZE[type];
    widgets.push({ id: `default_${type}`, type, ...size, ...findNextSlot(widgets, size.w, size.h) });
  }
  return { version: 2, widgets };
}

const WIDGET_TYPES = new Set<WidgetType>([
  "project_status",
  "project_progress",
  "my_tasks",
  "stuck_tasks",
  "activity",
  "agent_ops",
]);

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function findNextSlot(
  widgets: Array<{ x: number; y: number; w: number; h: number }>,
  w: number,
  h: number,
  cols = GRID_COLS,
): { x: number; y: number } {
  const width = Math.min(Math.max(1, w), cols);
  const height = Math.max(1, h);
  const maxY = widgets.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= cols - width; x++) {
      const candidate = { x, y, w: width, h: height };
      if (!widgets.some((item) => overlaps(candidate, item))) return { x, y };
    }
  }
  return { x: 0, y: maxY };
}

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === "string" && WIDGET_TYPES.has(value as WidgetType);
}

function isGridWidget(value: unknown): value is WidgetInstance {
  if (!value || typeof value !== "object") return false;
  const widget = value as Partial<WidgetInstance>;
  return (
    typeof widget.id === "string" &&
    isWidgetType(widget.type) &&
    Number.isInteger(widget.x) &&
    Number.isInteger(widget.y) &&
    Number.isInteger(widget.w) &&
    Number.isInteger(widget.h) &&
    widget.x! >= 0 &&
    widget.x! < GRID_COLS &&
    widget.y! >= 0 &&
    widget.w! >= 1 &&
    widget.w! <= GRID_COLS &&
    widget.h! >= 1
  );
}

export function normalizeLayout(raw: unknown, isAdmin = false): DashboardLayout {
  if (!raw || typeof raw !== "object" || !("widgets" in raw) || !Array.isArray((raw as DashboardLayout).widgets)) {
    return defaultLayout(isAdmin);
  }
  const widgets = (raw as { widgets: unknown[] }).widgets.filter(isGridWidget);
  if (widgets.length === 0 && (raw as { widgets: unknown[] }).widgets.length > 0) {
    return defaultLayout(isAdmin);
  }
  return { version: 2, widgets };
}

export function loadLayout(isAdmin = false): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLayout(isAdmin);
    return normalizeLayout(JSON.parse(raw) as unknown, isAdmin);
  } catch {
    return defaultLayout(isAdmin);
  }
}

export function saveLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, widgets: layout.widgets }));
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
