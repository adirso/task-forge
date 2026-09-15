import type { Phase, Task } from "@taskforge/contracts";
import type { ModuleLayout } from "../components/ModularDashboard";
import { findNextSlot } from "./dashboard";

export const PROJECT_MODULES = {
  workflow: { label: "Workflow distribution", description: "Task counts across project statuses" },
  priority: { label: "Open work by priority", description: "Priority distribution of unfinished tasks" },
  workload: { label: "Assignee workload", description: "Open task counts by assignee, including unassigned work" },
  attention: { label: "Needs attention", description: "Overdue, blocked, failed, and stale work" },
  durations: { label: "Time by status", description: "Aggregate tracked time from task status history" },
  phases: { label: "Phase health", description: "Completed, open, and cancelled tasks per phase" },
  delivery: { label: "Delivery checkpoints", description: "Failed delivery checkpoints for this project's tasks" },
};
export type ProjectModule = keyof typeof PROJECT_MODULES;
export type ProjectLayout = ModuleLayout<ProjectModule>;
export const PROJECT_MODULE_SIZE = { w: 6, h: 4, minW: 3, minH: 3 };

export function defaultProjectLayout(): ProjectLayout {
  const widgets: ProjectLayout["widgets"] = [];
  for (const type of Object.keys(PROJECT_MODULES) as ProjectModule[]) {
    widgets.push({ id: `project_${type}`, type, w: 6, h: 4, ...findNextSlot(widgets, 6, 4) });
  }
  return { version: 2, widgets };
}

export function normalizeProjectLayout(raw: unknown): ProjectLayout {
  if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 2 || !("widgets" in raw) || !Array.isArray(raw.widgets)) return defaultProjectLayout();
  const ids = new Set<string>();
  const widgets = raw.widgets.filter((widget): widget is ProjectLayout["widgets"][number] => {
    if (!widget || typeof widget !== "object" || typeof widget.id !== "string" || ids.has(widget.id) || !Object.hasOwn(PROJECT_MODULES, widget.type)) return false;
    if (![widget.x, widget.y, widget.w, widget.h].every(Number.isInteger) || widget.x < 0 || widget.y < 0 || widget.w < 3 || widget.h < 3 || widget.x + widget.w > 12 || widget.y > 1000 || widget.h > 100) return false;
    ids.add(widget.id);
    return true;
  });
  return widgets.length || raw.widgets.length === 0 ? { version: 2, widgets } : defaultProjectLayout();
}

export function loadProjectLayout(projectId: string): ProjectLayout {
  try { return normalizeProjectLayout(JSON.parse(localStorage.getItem(`taskforge_project_dashboard_${projectId}`) ?? "null")); }
  catch { return defaultProjectLayout(); }
}
export function saveProjectLayout(projectId: string, layout: ProjectLayout) {
  try { localStorage.setItem(`taskforge_project_dashboard_${projectId}`, JSON.stringify(layout)); }
  catch { /* Layout customization remains usable when browser storage is unavailable. */ }
}

export const isOpenTask = (task: Task) => task.status !== "DONE" && task.status !== "CANCELLED";
export function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`.replace(/ 0m$/, "");
}
function endOfLocalDate(date: string) {
  return new Date(`${date}T23:59:59.999`).getTime();
}
function counts(tasks: Task[], key: (task: Task) => string) {
  const result = new Map<string, number>();
  for (const task of tasks) result.set(key(task), (result.get(key(task)) ?? 0) + 1);
  return [...result].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
export function projectMetrics(projectId: string, allTasks: Task[], allPhases: Phase[], now = Date.now()) {
  const tasks = allTasks.filter((task) => task.projectId === projectId);
  const open = tasks.filter(isOpenTask);
  const durations = new Map<string, number>();
  for (const task of tasks) for (const [status, seconds] of Object.entries(task.statusDurations ?? {})) {
    if (Number.isFinite(seconds) && seconds > 0) durations.set(status, (durations.get(status) ?? 0) + seconds);
  }
  return {
    tasks, open,
    done: tasks.filter((task) => task.status === "DONE").length,
    cancelled: tasks.filter((task) => task.status === "CANCELLED").length,
    workflow: counts(tasks, (task) => task.status),
    priority: ["URGENT", "HIGH", "MEDIUM", "LOW"].map((label) => ({ label, value: open.filter((task) => task.priority === label).length })),
    workload: counts(open, (task) => task.assigneeId ?? "unassigned").map(({ label, value }) => ({ label: label === "unassigned" ? "Unassigned" : tasks.find((task) => task.assigneeId === label)?.assignee?.name ?? "Unknown assignee", value })),
    durations: [...durations].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    attention: {
      overdue: open.filter((task) => task.dueDate && endOfLocalDate(task.dueDate) < now),
      blocked: open.filter((task) => task.blockedReason || task.dependencies.some((dependency) => dependency.isBlocking)),
      failed: open.filter((task) => task.status === "FAILED"),
      stale: open.filter((task) => task.status === "IN_PROGRESS" && now - Date.parse(task.updatedAt) >= 4 * 60 * 60 * 1000),
    },
    phases: allPhases.filter((phase) => phase.projectId === projectId).map((phase) => {
      const phaseTasks = tasks.filter((task) => task.phaseId === phase.id);
      return { ...phase, total: phaseTasks.length, done: phaseTasks.filter((task) => task.status === "DONE").length, open: phaseTasks.filter(isOpenTask).length, cancelled: phaseTasks.filter((task) => task.status === "CANCELLED").length };
    }),
  };
}
