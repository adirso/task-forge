import type { Project } from "@taskforge/contracts";
import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useWidgetQuery } from "../../lib/widgetQuery";
import {
  defaultProjectLayout,
  loadProjectLayout,
  PROJECT_MODULES,
  PROJECT_MODULE_SIZE,
  projectMetrics,
  saveProjectLayout,
  type ProjectModule,
} from "../../lib/projectDashboard";
import { ModularDashboard } from "../../components/ModularDashboard";
import { WidgetError } from "../../components/WidgetShell";
import { ProjectModuleContent } from "./parts/ProjectModuleContent";
import type { ProjectDashboardPageProps } from "./types";
import styles from "./ProjectDashboardPage.module.css";

const catalog = Object.fromEntries(
  Object.entries(PROJECT_MODULES).map(([type, module]) => [type, { ...module, ...PROJECT_MODULE_SIZE, icon: <BarChart3 /> }]),
) as Record<ProjectModule, typeof PROJECT_MODULES[ProjectModule] & typeof PROJECT_MODULE_SIZE & { icon: React.ReactNode }>;

function ProjectDashboardData({ project }: { project: Project }) {
  const query = useWidgetQuery(async () => {
    const [taskData, phaseData] = await Promise.all([api.tasks(project.id), api.phases(project.id)]);
    return { tasks: taskData.tasks, phases: phaseData.phases };
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const metrics = query.data ? projectMetrics(project.id, query.data.tasks, query.data.phases, now) : null;
  return (
    <div className={`${styles.root} project-dashboard project-dashboard-modular`}>
      <div className={styles.heading}>
        <div>
          <span className="modal-kicker">Project overview · {project.key}</span>
          <h2>{project.name} dashboard</h2>
          <p>All tasks in this project, across phases. Open counts exclude completed and cancelled tasks.</p>
        </div>
        <button type="button" className="button button-secondary" disabled={query.loading} onClick={query.reload}>
          Refresh project data
        </button>
      </div>
      {metrics && (
        <div className={styles.metrics}>
          {(
            [
              ["Open tasks", metrics.open.length],
              ["Completed tasks", metrics.done],
              ["Cancelled tasks", metrics.cancelled],
              ["Open phases", metrics.phases.filter((phase) => phase.open > 0).length],
            ] as const
          ).map(([label, value]) => (
            <article key={label}>
              <BarChart3 />
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </div>
      )}
      <ModularDashboard
        catalog={catalog}
        load={() => loadProjectLayout(project.id)}
        save={(layout) => saveProjectLayout(project.id, layout)}
        defaults={defaultProjectLayout}
        render={(type) =>
          query.loading ? (
            <p role="status">Loading project metrics…</p>
          ) : query.error || !metrics ? (
            <WidgetError message="Could not load project metrics." onRetry={query.reload} />
          ) : (
            <ProjectModuleContent type={type} metrics={metrics} projectKey={project.key} />
          )
        }
      />
    </div>
  );
}

export function ProjectDashboardPage({ project }: ProjectDashboardPageProps) {
  // Remount queries and layout together so late responses cannot cross project boundaries.
  return <ProjectDashboardData key={project.id} project={project} />;
}
