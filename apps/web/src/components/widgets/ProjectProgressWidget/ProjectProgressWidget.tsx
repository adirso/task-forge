import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../../lib/api";
import { openProject } from "../../../lib/dashboardNav";
import { useWidgetQuery } from "../../../lib/widgetQuery";
import { formatAgentUsage } from "../../../lib/agentUsage";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../WidgetShell";
import styles from "./ProjectProgressWidget.module.css";

export function ProjectProgressWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <WidgetLoading />;
  if (data.projects.length === 0) return <WidgetEmpty>No projects yet.</WidgetEmpty>;

  return (
    <div className={styles.root}>
      {data.projects.map((p) => {
        const eligible = p.counts.total - p.counts.CANCELLED;
        const pct = eligible === 0 ? 0 : Math.round((p.counts.DONE / eligible) * 100);
        return (
          <button key={p.id} type="button" className={styles.row} onClick={() => openProject(p.key)}>
            <div className={styles.header}>
              <span className={styles.dot} style={{ background: p.color }} />
              <span className={styles.name} title={p.name}>{p.name}</span>
              <span className={styles.pct}>{pct}%</span>
            </div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${pct}%`, background: p.color }} />
            </div>
            <div className={styles.sub}>{p.counts.DONE} of {eligible} non-cancelled tasks done · {p.nonDoneTaskCount} remaining · {p.cancelledTaskCount} cancelled</div>
            <div className={styles.sub}>{p.nonDonePhaseCount} non-done phases</div>
            <div className={styles.sub}>Agent usage: {formatAgentUsage(p.agentUsage)}</div>
          </button>
        );
      })}
    </div>
  );
}
