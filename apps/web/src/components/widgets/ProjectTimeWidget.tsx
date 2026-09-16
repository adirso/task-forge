import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { openProject } from "../../lib/dashboardNav";
import { formatTrackedTime } from "../../lib/dashboard";
import { useWidgetQuery } from "../../lib/widgetQuery";
import { WidgetError } from "../WidgetShell";

export function ProjectTimeWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());
  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  const projects = data.projects.filter((project) => project.trackedTimeSeconds > 0);
  if (projects.length === 0) return <div className="widget-empty">No tracked time yet.</div>;
  const total = projects.reduce((sum, project) => sum + project.trackedTimeSeconds, 0);
  return (
    <div className="widget-project-time">
      <p className="wpt-period">All tracked time</p>
      {projects.map((project) => {
        const percentage = Math.round((project.trackedTimeSeconds / total) * 100);
        return <button key={project.id} type="button" className="wpt-row" onClick={() => openProject(project.key)}>
          <span className="wpt-name"><span className="wpt-dot" style={{ background: project.color }} />{project.name}</span>
          <span className="wpt-value">{formatTrackedTime(project.trackedTimeSeconds)} <small>{percentage}%</small></span>
        </button>;
      })}
      <div className="wpt-total">Total: {formatTrackedTime(total)}</div>
    </div>
  );
}
