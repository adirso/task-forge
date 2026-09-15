import type { Project } from "@taskforge/contracts";
import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { statusMeta } from "../lib/ui";
import { useWidgetQuery } from "../lib/widgetQuery";
import { defaultProjectLayout, formatDuration, loadProjectLayout, PROJECT_MODULES, PROJECT_MODULE_SIZE, projectMetrics, saveProjectLayout, type ProjectModule } from "../lib/projectDashboard";
import { ModularDashboard } from "./ModularDashboard";
import { WidgetError } from "./WidgetShell";

const catalog = Object.fromEntries(Object.entries(PROJECT_MODULES).map(([type, module]) => [type, { ...module, ...PROJECT_MODULE_SIZE, icon: <BarChart3 /> }])) as Record<ProjectModule, typeof PROJECT_MODULES[ProjectModule] & typeof PROJECT_MODULE_SIZE & { icon: React.ReactNode }>;
const statusLabel = (status: string) => statusMeta[status as keyof typeof statusMeta]?.label ?? status;
export function ProjectBars({ rows, empty, format = String }: { rows: Array<{ label: string; value: number }>; empty: string; format?: (value: number) => string }) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (!max) return <p className="widget-empty">{empty}</p>;
  return <ul className="project-chart" aria-label="Chart values">{rows.map((row, index) => <li key={`${row.label}-${index}`}>
    <div><span>{row.label}</span><strong>{format(row.value)}</strong></div>
    <div className="project-chart-track" aria-hidden="true"><span style={{ width: `${row.value / max * 100}%` }} /></div>
  </li>)}</ul>;
}

function DeliveryWidget({ taskIds }: { taskIds: Set<string> }) {
  const query = useWidgetQuery(api.deliveryMonitorHealth);
  if (query.loading) return <p role="status">Loading delivery checkpoints…</p>;
  if (query.error || !query.data) return <WidgetError message="Could not load delivery checkpoints." onRetry={query.reload} />;
  const failures = query.data.monitor.failures.filter((failure) => taskIds.has(failure.taskId));
  return <><p>Failed checkpoints for this project. Service state: {query.data.monitor.status} (global).</p>
    {failures.length ? <ul className="project-monitor-list">{failures.map((failure) => <li key={`${failure.runId}-${failure.taskId}`}><strong>Task {failure.taskId.slice(0, 8)}</strong><span>{failure.errorCategory ?? "Unknown error"}</span>{failure.nextRetryAt && <span>Retry: {new Date(failure.nextRetryAt).toLocaleString()}</span>}</li>)}</ul> : <p className="widget-empty">No failed delivery checkpoints for this project.</p>}
  </>;
}

type Metrics = ReturnType<typeof projectMetrics>;
export function ProjectModuleContent({ type, metrics, projectKey }: { type: ProjectModule; metrics: Metrics; projectKey: string }) {
  switch (type) {
    case "workflow": return <ProjectBars rows={metrics.workflow.map((row) => ({ ...row, label: statusLabel(row.label) }))} empty="No tasks in this project yet." />;
    case "priority": return <ProjectBars rows={metrics.priority} empty="No open tasks in this project." />;
    case "workload": return <ProjectBars rows={metrics.workload} empty="No open tasks in this project." />;
    case "durations": return <><p>Aggregate tracked time from task status history.</p><ProjectBars rows={metrics.durations.map((row) => ({ ...row, label: statusLabel(row.label) }))} format={formatDuration} empty="No duration data yet." /></>;
    case "phases": return metrics.phases.length ? <ul className="project-monitor-list">{metrics.phases.map((phase) => <li key={phase.id}><strong>Phase {phase.number}{phase.isActive ? " · Active" : ""}</strong><span>{phase.goal}</span><progress aria-label={`Phase ${phase.number} completed tasks`} max={phase.total || 1} value={phase.done} /><span>{phase.done} completed · {phase.open} open · {phase.cancelled} cancelled</span></li>)}</ul> : <p className="widget-empty">No phases in this project yet.</p>;
    case "attention": return <><p>Open work only. Stale means in progress without an update for 4+ hours. A task can appear in more than one group.</p>{Object.entries(metrics.attention).map(([label, tasks]) => <section className="project-attention-group" key={label}><h4>{label} · {tasks.length}</h4>{tasks.length ? <ul>{tasks.map((task) => <li key={task.id}><strong>{projectKey}-{task.number}</strong> {task.title}</li>)}</ul> : <p>No {label} tasks.</p>}</section>)}</>;
    case "delivery": return <DeliveryWidget taskIds={new Set(metrics.tasks.map((task) => task.id))} />;
  }
}

function ProjectDashboardData({ project }: { project: Project }) {
  const query = useWidgetQuery(async () => {
    const [taskData, phaseData] = await Promise.all([api.tasks(project.id), api.phases(project.id)]);
    return { tasks: taskData.tasks, phases: phaseData.phases };
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const metrics = query.data ? projectMetrics(project.id, query.data.tasks, query.data.phases, now) : null;
  return <div className="project-dashboard project-dashboard-modular">
    <div className="project-dashboard-heading"><div><span className="modal-kicker">Project overview · {project.key}</span><h2>{project.name} dashboard</h2><p>All tasks in this project, across phases. Open counts exclude completed and cancelled tasks.</p></div><button type="button" className="button button-secondary" disabled={query.loading} onClick={query.reload}>Refresh project data</button></div>
    {metrics && <div className="project-dashboard-metrics">{[["Open tasks", metrics.open.length], ["Completed tasks", metrics.done], ["Cancelled tasks", metrics.cancelled], ["Open phases", metrics.phases.filter((phase) => phase.open > 0).length]].map(([label, value]) => <article key={label}><BarChart3 /><strong>{value}</strong><span>{label}</span></article>)}</div>}
    <ModularDashboard catalog={catalog} load={() => loadProjectLayout(project.id)} save={(layout) => saveProjectLayout(project.id, layout)} defaults={defaultProjectLayout}
      render={(type) => query.loading ? <p role="status">Loading project metrics…</p> : query.error || !metrics ? <WidgetError message="Could not load project metrics." onRetry={query.reload} /> : <ProjectModuleContent type={type} metrics={metrics} projectKey={project.key} />} />
  </div>;
}

export function ProjectDashboard({ project }: { project: Project }) {
  // Remount queries and layout together so late responses cannot cross project boundaries.
  return <ProjectDashboardData key={project.id} project={project} />;
}
