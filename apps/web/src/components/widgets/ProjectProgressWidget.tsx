import { useEffect, useState } from "react";
import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { openProject } from "../../lib/dashboardNav";

export function ProjectProgressWidget() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboardSummary().then(setData).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) return <div className="widget-error">{error}</div>;
  if (!data) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (data.projects.length === 0) return <div className="widget-empty">No projects yet.</div>;

  return (
    <div className="widget-project-progress">
      {data.projects.map((p) => {
        const pct = p.counts.total === 0 ? 0 : Math.round((p.counts.DONE / p.counts.total) * 100);
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
            <div className="wpp-sub">{p.counts.DONE} of {p.counts.total} tasks done</div>
          </button>
        );
      })}
    </div>
  );
}
