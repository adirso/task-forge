import { Activity, AlertTriangle, BarChart2, Bot, CheckSquare, TrendingUp } from "lucide-react";
import type { User } from "@taskforge/contracts";
import { ModularDashboard } from "./ModularDashboard";
import { ProjectStatusWidget } from "./widgets/ProjectStatusWidget";
import { ProjectProgressWidget } from "./widgets/ProjectProgressWidget";
import { MyTasksWidget } from "./widgets/MyTasksWidget";
import { StuckTasksWidget } from "./widgets/StuckTasksWidget";
import { ActivityWidget } from "./widgets/ActivityWidget";
import { AgentOpsWidget } from "./widgets/AgentOpsWidget";
import { DEFAULT_WIDGET_SIZE, defaultLayout, loadLayout, saveLayout, WIDGET_LABELS, WIDGET_DESCRIPTIONS, type WidgetType } from "../lib/dashboard";

const WIDGET_ICONS: Record<WidgetType, React.ReactNode> = {
  project_status: <BarChart2 />,
  project_progress: <TrendingUp />,
  my_tasks: <CheckSquare />,
  stuck_tasks: <AlertTriangle />,
  activity: <Activity />,
  agent_ops: <Bot />,
};

const ALL_TYPES: WidgetType[] = [
  "project_status",
  "project_progress",
  "my_tasks",
  "stuck_tasks",
  "activity",
  "agent_ops",
];

function renderWidgetContent(type: WidgetType, currentUser: User) {
  switch (type) {
    case "project_status": return <ProjectStatusWidget />;
    case "project_progress": return <ProjectProgressWidget />;
    case "my_tasks": return <MyTasksWidget />;
    case "stuck_tasks": return <StuckTasksWidget />;
    case "activity": return <ActivityWidget />;
    case "agent_ops": return <AgentOpsWidget currentUser={currentUser} />;
  }
}

const catalog = Object.fromEntries(ALL_TYPES.map((type) => [type, {
  ...DEFAULT_WIDGET_SIZE[type], label: WIDGET_LABELS[type], description: WIDGET_DESCRIPTIONS[type], icon: WIDGET_ICONS[type],
}])) as Record<WidgetType, typeof DEFAULT_WIDGET_SIZE[WidgetType] & { label: string; description: string; icon: React.ReactNode }>;

export function DashboardPage({ currentUser }: { currentUser: User }) {
  return <ModularDashboard catalog={catalog} load={() => loadLayout(currentUser.role === "ADMIN")} save={saveLayout}
    defaults={() => defaultLayout(currentUser.role === "ADMIN")} render={(type) => renderWidgetContent(type, currentUser)} />;
}
