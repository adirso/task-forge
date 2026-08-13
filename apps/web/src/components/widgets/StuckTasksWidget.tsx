import { useEffect, useState } from "react";
import type { DashboardSummary } from "@taskforge/contracts";
import { AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { openTask } from "../../lib/dashboardNav";

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function StuckTasksWidget() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboardSummary().then(setData).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) return <div className="widget-error">{error}</div>;
  if (!data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (data.stuckTasks.length === 0) return <div className="widget-empty"><AlertTriangle style={{ width: 18, opacity: 0.4 }} /> No stuck tasks — nice!</div>;

  return (
    <div className="widget-task-list">
      {data.stuckTasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="wtl-row wtl-row-stuck"
          onClick={() => openTask(task.projectKey, task.number)}
        >
          <span className="wtl-key">{task.projectKey}-{task.number}</span>
          <span className="wtl-title">{task.title}</span>
          <span className="wtl-meta">
            {task.assigneeName ? `@${task.assigneeName.split(" ")[0]}` : "Unassigned"}
            {" · "}
            {formatRelative(task.updatedAt)}
          </span>
        </button>
      ))}
    </div>
  );
}
