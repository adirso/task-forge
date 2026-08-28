import type { DeliveryMonitorHealth, Phase, Project, Task } from "@taskforge/contracts";
import { BarChart3, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { statusMeta } from "../lib/ui";
import { api } from "../lib/api";
import { useEffect, useState } from "react";

function duration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function ProjectDashboard({ project, tasks, phases }: { project: Project; tasks: Task[]; phases: Phase[] }) {
  const [monitor, setMonitor] = useState<DeliveryMonitorHealth | null>(null);
  const [activeLeases, setActiveLeases] = useState<Array<{ runId: string; ownerId: string; expiresAt: string }>>([]);
  useEffect(() => { let active = true; void api.deliveryMonitorHealth().then((result) => { if (active) { setMonitor(result.monitor); setActiveLeases(result.activeLeases); } }).catch(() => { if (active) { setMonitor(null); setActiveLeases([]); } }); return () => { active = false; }; }, []);
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
    <div className="project-dashboard-grid"><section className="project-dashboard-card"><h3>Time by status</h3><p>Aggregate tracked time from task status history.</p>{statuses.length ? <div className="project-dashboard-status-list">{statuses.map((status) => <div key={status}><span>{statusMeta[status as keyof typeof statusMeta]?.label ?? status}</span><strong>{duration(durations.get(status) ?? 0)}</strong></div>)}</div> : <div className="project-dashboard-empty">No duration data yet.</div>}</section><section className="project-dashboard-card"><h3>Phase health</h3><p>Cancelled tasks are excluded from non-done counts.</p><div className="project-dashboard-status-list">{phases.map((phase) => <div key={phase.id}><span>Phase {phase.number}</span><strong>{phase.nonDoneTaskCount ?? 0} open · {phase.cancelledTaskCount ?? 0} cancelled</strong></div>)}</div></section><section className="project-dashboard-card" aria-label="Delivery Monitor health"><h3>Delivery Monitor</h3><p>GitHub synchronization and retry checkpoints.</p>{monitor ? <div className="project-dashboard-status-list"><div><span>State</span><strong>{monitor.status}</strong></div><div><span>Last sweep</span><strong>{monitor.lastSweepAt ? new Date(monitor.lastSweepAt).toLocaleString() : "Not yet run"}</strong></div><div><span>Processed checkpoints (total)</span><strong>{monitor.processedCount}</strong></div><div><span>Active leases</span><strong>{monitor.activeLeaseCount}</strong></div>{activeLeases.map((lease) => <div key={lease.runId}><span>Lease · {lease.ownerId}</span><strong>until {new Date(lease.expiresAt).toLocaleString()}</strong></div>)}{monitor.nextRetryAt && <div><span>Next retry</span><strong>{new Date(monitor.nextRetryAt).toLocaleString()}</strong></div>}{monitor.failures.length > 0 && <div><span>Failed checkpoints</span><strong>{monitor.failures.length}</strong></div>}{monitor.failures.map((failure) => <div key={`${failure.runId}-${failure.taskId}`}><span>{failure.taskId.slice(0, 8)} · {failure.state ?? "unknown"}</span><strong>{failure.errorCategory ?? "Unknown error"}{failure.nextRetryAt ? ` · retry ${new Date(failure.nextRetryAt).toLocaleString()}` : ""}</strong></div>)}</div> : <div className="project-dashboard-empty">Monitor health unavailable.</div>}</section></div>
  </div>;
}
