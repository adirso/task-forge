import { Activity, AlertTriangle, BarChart2, Bot, CheckSquare, TrendingUp } from "lucide-react";
import type { User } from "@taskforge/contracts";
import type { DashboardPageProps } from "./types";
import styles from "./DashboardPage.module.css";
import { ModularDashboard } from "../../components/ModularDashboard";
import { ProjectStatusWidget } from "../../components/widgets/ProjectStatusWidget";
import { ProjectProgressWidget } from "../../components/widgets/ProjectProgressWidget";
import { ProjectTimeWidget } from "../../components/widgets/ProjectTimeWidget";
import { MyTasksWidget } from "../../components/widgets/MyTasksWidget";
import { StuckTasksWidget } from "../../components/widgets/StuckTasksWidget";
import { ActivityWidget } from "../../components/widgets/ActivityWidget";
import { AgentOpsWidget } from "../../components/widgets/AgentOpsWidget";
import { DEFAULT_WIDGET_SIZE, defaultLayout, loadLayout, saveLayout, WIDGET_LABELS, WIDGET_DESCRIPTIONS, type WidgetType } from "../../lib/dashboard";

const WIDGET_ICONS: Record<WidgetType, React.ReactNode> = {
  project_status: <BarChart2 />,
  project_progress: <TrendingUp />,
  project_time: <TrendingUp />,
  my_tasks: <CheckSquare />,
  stuck_tasks: <AlertTriangle />,
  activity: <Activity />,
  agent_ops: <Bot />,
};

const ALL_TYPES: WidgetType[] = [
  "project_status",
  "project_progress",
  "project_time",
  "my_tasks",
  "stuck_tasks",
  "activity",
  "agent_ops",
];

function renderWidgetContent(type: WidgetType, currentUser: User) {
  switch (type) {
    case "project_status": return <ProjectStatusWidget />;
    case "project_progress": return <ProjectProgressWidget />;
    case "project_time": return <ProjectTimeWidget />;
    case "my_tasks": return <MyTasksWidget />;
    case "stuck_tasks": return <StuckTasksWidget />;
    case "activity": return <ActivityWidget />;
    case "agent_ops": return <AgentOpsWidget currentUser={currentUser} />;
  }
}

const catalog = Object.fromEntries(ALL_TYPES.map((type) => [type, {
  ...DEFAULT_WIDGET_SIZE[type], label: WIDGET_LABELS[type], description: WIDGET_DESCRIPTIONS[type], icon: WIDGET_ICONS[type],
}])) as Record<WidgetType, typeof DEFAULT_WIDGET_SIZE[WidgetType] & { label: string; description: string; icon: React.ReactNode }>;

export function DashboardPage({ currentUser }: DashboardPageProps) {
  return (
    <div className={styles.root}>
      <ModularDashboard catalog={catalog} load={() => loadLayout(currentUser.role === "ADMIN")} save={saveLayout}
        defaults={() => defaultLayout(currentUser.role === "ADMIN")} render={(type) => renderWidgetContent(type, currentUser)} />
    </div>
  );
}
