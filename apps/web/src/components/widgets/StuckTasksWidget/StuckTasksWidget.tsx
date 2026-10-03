import type { DashboardSummary } from "@taskforge/contracts";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../lib/api";
import { openTask } from "../../../lib/dashboardNav";
import { useWidgetQuery } from "../../../lib/widgetQuery";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../WidgetShell";
import styles from "./StuckTasksWidget.module.css";

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function StuckTasksWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <WidgetLoading lines={2} />;
  if (data.stuckTasks.length === 0) return <WidgetEmpty><AlertTriangle style={{ width: 18, opacity: 0.4 }} /> No stuck tasks — nice!</WidgetEmpty>;

  return (
    <div className={styles.root}>
      {data.stuckTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className={`${styles.row} ${styles.rowStuck}`}
          onClick={() => openTask(task.projectKey, task.number)}
        >
          <span className={styles.key}>{task.projectKey}-{task.number}</span>
          <span className={styles.title}>{task.title}</span>
          <span className={styles.meta}>
            {task.assigneeName ? `@${task.assigneeName.split(" ")[0]}` : "Unassigned"}
            {" · "}
            {formatRelative(task.updatedAt)}
          </span>
        </button>
      ))}
    </div>
  );
}
