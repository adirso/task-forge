import type { Phase, Project, Task } from "@taskforge/contracts";
import { BarChart3, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { statusMeta } from "../lib/ui";

function duration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function ProjectDashboard({ project, tasks, phases }: { project: Project; tasks: Task[]; phases: Phase[] }) {
  const done = tasks.filter((task) => task.status === "DONE").length;
  const cancelled = tasks.filter((task) => task.status === "CANCELLED").length;
  const nonDone = tasks.length - done - cancelled;
  const nonDonePhases = phases.filter((phase) => (phase.nonDoneTaskCount ?? 0) > 0).length;
  const durations = new Map<string, number>();
  for (const task of tasks) for (const [status, seconds] of Object.entries(task.statusDurations ?? {})) durations.set(status, (durations.get(status) ?? 0) + seconds);
  const statuses = [...durations.keys()].sort((a, b) => (durations.get(b) ?? 0) - (durations.get(a) ?? 0));
  return <div className="project-dashboard">
    <div className="project-dashboard-heading"><div><span className="modal-kicker">Project overview</span><h2>{project.name} dashboard</h2><p>Delivery health, workflow progress, and time spent across this project.</p></div><BarChart3 /></div>
    <div className="project-dashboard-metrics"><article><Clock3 /><strong>{nonDone}</strong><span>Non-done tasks</span></article><article><CheckCircle2 /><strong>{done}</strong><span>Completed tasks</span></article><article><XCircle /><strong>{cancelled}</strong><span>Cancelled tasks</span></article><article><BarChart3 /><strong>{nonDonePhases}</strong><span>Non-done phases</span></article></div>
    <div className="project-dashboard-grid"><section className="project-dashboard-card"><h3>Time by status</h3><p>Aggregate tracked time from task status history.</p>{statuses.length ? <div className="project-dashboard-status-list">{statuses.map((status) => <div key={status}><span>{statusMeta[status as keyof typeof statusMeta]?.label ?? status}</span><strong>{duration(durations.get(status) ?? 0)}</strong></div>)}</div> : <div className="project-dashboard-empty">No duration data yet.</div>}</section><section className="project-dashboard-card"><h3>Phase health</h3><p>Cancelled tasks are excluded from non-done counts.</p><div className="project-dashboard-status-list">{phases.map((phase) => <div key={phase.id}><span>Phase {phase.number}</span><strong>{phase.nonDoneTaskCount ?? 0} open · {phase.cancelledTaskCount ?? 0} cancelled</strong></div>)}</div></section></div>
  </div>;
}
