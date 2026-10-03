import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../../lib/api";
import { openProject } from "../../../lib/dashboardNav";
import { formatTrackedTime } from "../../../lib/dashboard";
import { useWidgetQuery } from "../../../lib/widgetQuery";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../WidgetShell";
import styles from "./ProjectTimeWidget.module.css";

export function ProjectTimeWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());
  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <WidgetLoading />;
  const projects = data.projects.filter((project) => project.trackedTimeSeconds > 0);
  if (projects.length === 0) return <WidgetEmpty>No tracked time yet.</WidgetEmpty>;
  const total = projects.reduce((sum, project) => sum + project.trackedTimeSeconds, 0);
  return (
    <div className={styles.root}>
      <p className={styles.period}>All workflow time · excludes Backlog, Todo, Done and Cancelled</p>
      {projects.map((project) => {
        const percentage = Math.round((project.trackedTimeSeconds / total) * 100);
        return <button key={project.id} type="button" className={styles.row} onClick={() => openProject(project.key)}>
          <span className={styles.name}><span className={styles.dot} style={{ background: project.color }} />{project.name}</span>
          <span className={styles.value}>{formatTrackedTime(project.trackedTimeSeconds)} <small>{percentage}%</small></span>
        </button>;
      })}
      <div className={styles.total}>Total: {formatTrackedTime(total)}</div>
    </div>
  );
}
