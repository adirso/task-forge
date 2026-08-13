import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { openProject } from "../../lib/dashboardNav";
import { useWidgetQuery } from "../../lib/widgetQuery";
import { WidgetError } from "../WidgetShell";

export function ProjectStatusWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (data.projects.length === 0) return <div className="widget-empty">No projects yet.</div>;

  return (
    <div className="widget-project-status">
      {data.projects.map((p) => {
        const active = p.counts.TODO + p.counts.IN_PROGRESS + p.counts.IN_REVIEW;
        return (
          <button key={p.id} type="button" className="wps-row" onClick={() => openProject(p.key)}>
            <div className="wps-name" title={p.name}>
              <span className="wps-dot" style={{ background: p.color }} />
              {p.name}
            </div>
            <div className="wps-bars">
              {p.counts.total === 0 ? (
                <div className="wps-empty-bar" />
              ) : (
                <>
                  {p.counts.TODO > 0 && <div className="wps-bar wps-bar-todo" style={{ flex: p.counts.TODO }} title={`${p.counts.TODO} TODO`} />}
                  {p.counts.IN_PROGRESS > 0 && <div className="wps-bar wps-bar-inprogress" style={{ flex: p.counts.IN_PROGRESS }} title={`${p.counts.IN_PROGRESS} IN PROGRESS`} />}
                  {p.counts.IN_REVIEW > 0 && <div className="wps-bar wps-bar-inreview" style={{ flex: p.counts.IN_REVIEW }} title={`${p.counts.IN_REVIEW} IN REVIEW`} />}
                  {p.counts.DONE > 0 && <div className="wps-bar wps-bar-done" style={{ flex: p.counts.DONE }} title={`${p.counts.DONE} DONE`} />}
                </>
              )}
            </div>
            <div className="wps-count">{active} active</div>
          </button>
        );
      })}
      <div className="wps-legend">
        <span><span className="wps-dot wps-dot-todo" />TODO</span>
        <span><span className="wps-dot wps-dot-inprogress" />In progress</span>
        <span><span className="wps-dot wps-dot-inreview" />In review</span>
        <span><span className="wps-dot wps-dot-done" />Done</span>
      </div>
    </div>
  );
}
