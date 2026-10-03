import type { DashboardSummary } from "@taskforge/contracts";
import { api } from "../../../lib/api";
import { openProject } from "../../../lib/dashboardNav";
import { useWidgetQuery } from "../../../lib/widgetQuery";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../../WidgetShell";
import styles from "./ProjectStatusWidget.module.css";

export function ProjectStatusWidget() {
  const { data, error, loading, reload } = useWidgetQuery<DashboardSummary>(() => api.dashboardSummary());

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !data) return <WidgetLoading />;
  if (data.projects.length === 0) return <WidgetEmpty>No projects yet.</WidgetEmpty>;

  return (
    <div className={styles.root}>
      {data.projects.map((p) => {
        const planned = p.counts.REFINING + p.counts.TODO;
        const review = p.counts.READY_FOR_REVIEW + p.counts.IN_REVIEW;
        const closed = p.counts.DONE + p.counts.CANCELLED;
        const active = planned + p.counts.IN_PROGRESS + review;
        return (
          <button key={p.id} type="button" className={styles.row} onClick={() => openProject(p.key)}>
            <div className={styles.name} title={p.name}>
              <span className={styles.dot} style={{ background: p.color }} />
              {p.name}
            </div>
            <div className={styles.bars}>
              {p.counts.total === 0 ? (
                <div className={styles.emptyBar} />
              ) : (
                <>
                  {planned > 0 && <div className={`${styles.bar} ${styles.barTodo}`} style={{ flex: planned }} title={`${planned} planned or ready`} />}
                  {p.counts.IN_PROGRESS > 0 && <div className={`${styles.bar} ${styles.barInprogress}`} style={{ flex: p.counts.IN_PROGRESS }} title={`${p.counts.IN_PROGRESS} IN PROGRESS`} />}
                  {review > 0 && <div className={`${styles.bar} ${styles.barInreview}`} style={{ flex: review }} title={`${review} ready for or in review`} />}
                  {closed > 0 && <div className={`${styles.bar} ${styles.barDone}`} style={{ flex: closed }} title={`${closed} done or cancelled`} />}
                </>
              )}
            </div>
            <div className={styles.count}>{active} active</div>
          </button>
        );
      })}
      <div className={styles.legend}>
        <span><span className={`${styles.dot} ${styles.dotTodo}`} />Planned</span>
        <span><span className={`${styles.dot} ${styles.dotInprogress}`} />In progress</span>
        <span><span className={`${styles.dot} ${styles.dotInreview}`} />Review</span>
        <span><span className={`${styles.dot} ${styles.dotDone}`} />Closed</span>
      </div>
    </div>
  );
}
