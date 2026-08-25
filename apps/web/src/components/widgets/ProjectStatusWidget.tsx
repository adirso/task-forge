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
        const planned = p.counts.REFINING + p.counts.TODO;
        const review = p.counts.READY_FOR_REVIEW + p.counts.IN_REVIEW;
        const closed = p.counts.DONE + p.counts.CANCELLED;
        const active = planned + p.counts.IN_PROGRESS + review;
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
                  {planned > 0 && <div className="wps-bar wps-bar-todo" style={{ flex: planned }} title={`${planned} planned or ready`} />}
                  {p.counts.IN_PROGRESS > 0 && <div className="wps-bar wps-bar-inprogress" style={{ flex: p.counts.IN_PROGRESS }} title={`${p.counts.IN_PROGRESS} IN PROGRESS`} />}
                  {review > 0 && <div className="wps-bar wps-bar-inreview" style={{ flex: review }} title={`${review} ready for or in review`} />}
                  {closed > 0 && <div className="wps-bar wps-bar-done" style={{ flex: closed }} title={`${closed} done or cancelled`} />}
                </>
              )}
            </div>
            <div className="wps-count">{active} active</div>
          </button>
        );
      })}
      <div className="wps-legend">
        <span><span className="wps-dot wps-dot-todo" />Planned</span>
        <span><span className="wps-dot wps-dot-inprogress" />In progress</span>
        <span><span className="wps-dot wps-dot-inreview" />Review</span>
        <span><span className="wps-dot wps-dot-done" />Closed</span>
      </div>
    </div>
  );
}
