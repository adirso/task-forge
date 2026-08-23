import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { openProject } from "../../lib/dashboardNav";
import { useWidgetQuery } from "../../lib/widgetQuery";
import { WidgetError } from "../WidgetShell";

export function ProjectProgressWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (data.projects.length === 0) return <div className="widget-empty">No projects yet.</div>;

  return (
    <div className="widget-project-progress">
      {data.projects.map((p) => {
        const eligible = p.counts.total - p.counts.CANCELLED;
        const pct = eligible === 0 ? 0 : Math.round((p.counts.DONE / eligible) * 100);
        return (
          <button key={p.id} type="button" className="wpp-row" onClick={() => openProject(p.key)}>
            <div className="wpp-header">
              <span className="wpp-dot" style={{ background: p.color }} />
              <span className="wpp-name" title={p.name}>{p.name}</span>
              <span className="wpp-pct">{pct}%</span>
            </div>
            <div className="wpp-track">
              <div className="wpp-fill" style={{ width: `${pct}%`, background: p.color }} />
            </div>
            <div className="wpp-sub">{p.counts.DONE} of {eligible} non-cancelled tasks done · {p.nonDoneTaskCount} remaining · {p.cancelledTaskCount} cancelled</div>
            <div className="wpp-sub">{p.nonDonePhaseCount} non-done phases</div>
          </button>
        );
      })}
    </div>
  );
}
