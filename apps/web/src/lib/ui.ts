import type { TaskPriority, TaskStatus, TaskType } from "@taskforge/contracts";
import { Bug, FileText, RefreshCw, Server, ShieldCheck, Sparkles, Wrench, type LucideIcon } from "lucide-react";

export const statusMeta: Record<TaskStatus, { label: string; tone: string }> = {
  BACKLOG: { label: "Backlog", tone: "slate" },
  REFINING: { label: "Refining", tone: "teal" },
  TODO: { label: "To do", tone: "blue" },
  READY_FOR_DEV: { label: "Ready for dev", tone: "indigo" },
  IN_PROGRESS: { label: "In progress", tone: "purple" },
  READY_FOR_REVIEW: { label: "Ready for review", tone: "orange" },
  IN_REVIEW: { label: "In review", tone: "amber" },
  DONE: { label: "Done", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
  APPROVED: { label: "Approved", tone: "green" },
  RE_REVIEW: { label: "Re-review", tone: "amber" },
  FIX_NEEDED: { label: "Fix needed", tone: "red" },
  PENDING_DECISION: { label: "Pending decision", tone: "orange" },
  FAILED: { label: "Failed", tone: "red" },
};

export const priorityMeta: Record<TaskPriority, { label: string; symbol: string }> = {
  LOW: { label: "Low", symbol: "↓" },
  MEDIUM: { label: "Medium", symbol: "=" },
  HIGH: { label: "High", symbol: "↑" },
  URGENT: { label: "Urgent", symbol: "↑↑" },
};

export const taskTypeMeta: Record<TaskType, { label: string; icon: LucideIcon }> = {
  FEATURE: { label: "Feature", icon: Sparkles },
  BUG: { label: "Bug", icon: Bug },
  INFRA: { label: "Infra", icon: Server },
  UPDATE: { label: "Update", icon: RefreshCw },
  SECURITY: { label: "Security", icon: ShieldCheck },
  DOCS: { label: "Docs", icon: FileText },
  CHORE: { label: "Chore", icon: Wrench },
};

export function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}
