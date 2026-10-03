import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../../lib/api";
import { openTask } from "../../../lib/dashboardNav";
import { useWidgetQuery } from "../../../lib/widgetQuery";
import { statusMeta } from "../../../lib/ui";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../WidgetShell";
import styles from "./MyTasksWidget.module.css";

const STATUS_CLASS: Record<string, string | undefined> = {
  todo: styles.statusTodo,
  "in-progress": styles.statusInProgress,
  "in-review": styles.statusInReview,
};

export function MyTasksWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <WidgetLoading />;
  if (data.myTasks.length === 0) return <WidgetEmpty>No open tasks assigned to you.</WidgetEmpty>;

  return (
    <div className={styles.root}>
      {data.myTasks.map((task) => {
        const statusKey = task.status.toLowerCase().replaceAll("_", "-");
        return (
          <button
            key={task.id}
            type="button"
            className={styles.row}
            onClick={() => openTask(task.projectKey, task.number)}
          >
            <span className={styles.key}>{task.projectKey}-{task.number}</span>
            <span className={styles.title}>{task.title}</span>
            <span className={`${styles.status} ${STATUS_CLASS[statusKey] ?? ""}`}>
              {statusMeta[task.status].label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
