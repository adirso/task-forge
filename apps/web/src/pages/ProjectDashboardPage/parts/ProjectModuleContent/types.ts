import { projectMetrics, type ProjectModule } from "../../../../lib/projectDashboard";

export type ProjectMetrics = ReturnType<typeof projectMetrics>;

export interface ProjectModuleContentProps {
  type: ProjectModule;
  metrics: ProjectMetrics;
  projectKey: string;
}
