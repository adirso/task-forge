import { useEffect, useState } from "react";
import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { openTask } from "../../lib/dashboardNav";

const STATUS_LABELS: Record<string, string> = {
  TODO: "Todo",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
};

export function MyTasksWidget() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboardSummary().then(setData).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) return <div className="widget-error">{error}</div>;
  if (!data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (data.myTasks.length === 0) return <div className="widget-empty">No open tasks assigned to you.</div>;

  return (
    <div className="widget-task-list">
      {data.myTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="wtl-row"
          onClick={() => openTask(task.projectKey, task.number)}
        >
          <span className="wtl-key">{task.projectKey}-{task.number}</span>
          <span className="wtl-title">{task.title}</span>
          <span className={`wtl-status wtl-status-${task.status.toLowerCase().replace("_", "-")}`}>
            {STATUS_LABELS[task.status] ?? task.status}
          </span>
        </button>
      ))}
    </div>
  );
}
