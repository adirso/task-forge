import { api } from "../../../../lib/api";
import { formatDuration } from "../../../../lib/projectDashboard";
import { statusMeta } from "../../../../lib/ui";
import { useWidgetQuery } from "../../../../lib/widgetQuery";
import { WidgetEmpty, WidgetError } from "../../../../components/WidgetShell";
import { ProjectBars } from "../ProjectBars";
import type { ProjectModuleContentProps } from "./types";
import styles from "./ProjectModuleContent.module.css";

const statusLabel = (status: string) => statusMeta[status as keyof typeof statusMeta]?.label ?? status;

function DeliveryWidget({ taskIds }: { taskIds: Set<string> }) {
  const query = useWidgetQuery(api.deliveryMonitorHealth);
  if (query.loading) return <p role="status">Loading delivery checkpoints…</p>;
  if (query.error || !query.data) return <WidgetError message="Could not load delivery checkpoints." onRetry={query.reload} />;
  const failures = query.data.monitor.failures.filter((failure) => taskIds.has(failure.taskId));
  return (
    <>
      <p className={styles.copy}>Failed checkpoints for this project. Service state: {query.data.monitor.status} (global).</p>
      {failures.length ? (
        <ul className={styles.monitorList}>
          {failures.map((failure) => (
            <li key={`${failure.runId}-${failure.taskId}`}>
              <strong>Task {failure.taskId.slice(0, 8)}</strong>
              <span>{failure.errorCategory ?? "Unknown error"}</span>
              {failure.nextRetryAt && <span>Retry: {new Date(failure.nextRetryAt).toLocaleString()}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <WidgetEmpty>No failed delivery checkpoints for this project.</WidgetEmpty>
      )}
    </>
  );
}

export function ProjectModuleContent({ type, metrics, projectKey }: ProjectModuleContentProps) {
  switch (type) {
    case "workflow":
      return <ProjectBars rows={metrics.workflow.map((row) => ({ ...row, label: statusLabel(row.label) }))} empty="No tasks in this project yet." />;
    case "priority":
      return <ProjectBars rows={metrics.priority} empty="No open tasks in this project." />;
    case "workload":
      return <ProjectBars rows={metrics.workload} empty="No open tasks in this project." />;
    case "durations":
      return (
        <>
          <p className={styles.copy}>Aggregate tracked time from task status history.</p>
          <ProjectBars rows={metrics.durations.map((row) => ({ ...row, label: statusLabel(row.label) }))} format={formatDuration} empty="No duration data yet." />
        </>
      );
    case "phases":
      return metrics.phases.length ? (
        <ul className={styles.monitorList}>
          {metrics.phases.map((phase) => (
            <li key={phase.id}>
              <strong>Phase {phase.number}{phase.isActive ? " · Active" : ""}</strong>
              <span>{phase.goal}</span>
              <progress aria-label={`Phase ${phase.number} completed tasks`} max={phase.total || 1} value={phase.done} />
              <span>{phase.done} completed · {phase.open} open · {phase.cancelled} cancelled</span>
            </li>
          ))}
        </ul>
      ) : (
        <WidgetEmpty>No phases in this project yet.</WidgetEmpty>
      );
    case "attention":
      return (
        <>
          <p className={styles.copy}>Open work only. Stale means in progress without an update for 4+ hours. A task can appear in more than one group.</p>
          {Object.entries(metrics.attention).map(([label, tasks]) => (
            <section className={styles.attentionGroup} key={label}>
              <h4>{label} · {tasks.length}</h4>
              {tasks.length ? (
                <ul>{tasks.map((task) => <li key={task.id}><strong>{projectKey}-{task.number}</strong> {task.title}</li>)}</ul>
              ) : (
                <p>No {label} tasks.</p>
              )}
            </section>
          ))}
        </>
      );
    case "delivery":
      return <DeliveryWidget taskIds={new Set(metrics.tasks.map((task) => task.id))} />;
  }
}
