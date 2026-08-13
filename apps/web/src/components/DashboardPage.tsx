import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bot,
  CheckSquare,
  LayoutDashboard,
  Plus,
  TrendingUp,
  X,
} from "lucide-react";
import { WidgetShell } from "./WidgetShell";
import { ProjectStatusWidget } from "./widgets/ProjectStatusWidget";
import { ProjectProgressWidget } from "./widgets/ProjectProgressWidget";
import { MyTasksWidget } from "./widgets/MyTasksWidget";
import { StuckTasksWidget } from "./widgets/StuckTasksWidget";
import { ActivityWidget } from "./widgets/ActivityWidget";
import { AgentOpsWidget } from "./widgets/AgentOpsWidget";
import {
  loadLayout,
  makeWidgetId,
  saveLayout,
  WIDGET_DESCRIPTIONS,
  WIDGET_LABELS,
  type WidgetInstance,
  type WidgetType,
} from "../lib/dashboard";
import type { User } from "@taskforge/contracts";

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

export function DashboardPage({ currentUser }: { currentUser: User }) {
  const [layout, setLayout] = useState(loadLayout);
  const [showPicker, setShowPicker] = useState(false);
  const [topId, setTopId] = useState<string | null>(null);

  function addWidget(type: WidgetType) {
    const offset = layout.widgets.length * 20;
    const newWidget: WidgetInstance = {
      id: makeWidgetId(),
      type,
      x: 24 + offset,
      y: 24 + offset,
    };
    const updated = { widgets: [...layout.widgets, newWidget] };
    setLayout(updated);
    saveLayout(updated);
    setShowPicker(false);
    setTopId(newWidget.id);
  }

  function removeWidget(id: string) {
    const updated = { widgets: layout.widgets.filter((w) => w.id !== id) };
    setLayout(updated);
    saveLayout(updated);
  }

  function handleStop(id: string, x: number, y: number) {
    const updated = {
      widgets: layout.widgets.map((w) => w.id === id ? { ...w, x, y } : w),
    };
    setLayout(updated);
    saveLayout(updated);
  }

  const zOrder = layout.widgets.map((w) => w.id);
  function getZ(id: string) {
    if (id === topId) return layout.widgets.length + 1;
    return zOrder.indexOf(id) + 1;
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-canvas">
        {layout.widgets.length === 0 && (
          <div className="dashboard-empty">
            <LayoutDashboard />
            <h3>Your dashboard is empty</h3>
            <p>Click <strong>+ Add widget</strong> to get started.</p>
          </div>
        )}

        {layout.widgets.map((w) => (
          <WidgetShell
            key={w.id}
            id={w.id}
            type={w.type}
            x={w.x}
            y={w.y}
            icon={WIDGET_ICONS[w.type]}
            onClose={() => removeWidget(w.id)}
            onStop={(x, y) => handleStop(w.id, x, y)}
            zIndex={getZ(w.id)}
            onFocus={() => setTopId(w.id)}
          >
            {renderWidgetContent(w.type, currentUser)}
          </WidgetShell>
        ))}
      </div>

      {/* Widget picker */}
      <div className="dashboard-fab-area">
        {showPicker && (
          <div className="widget-picker">
            <div className="widget-picker-header">
              <span>Add widget</span>
              <button type="button" onClick={() => setShowPicker(false)} className="widget-picker-close"><X /></button>
            </div>
            <div className="widget-picker-list">
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="widget-picker-item"
                  onClick={() => addWidget(type)}
                >
                  <span className="widget-picker-icon">{WIDGET_ICONS[type]}</span>
                  <span className="widget-picker-text">
                    <strong>{WIDGET_LABELS[type]}</strong>
                    <small>{WIDGET_DESCRIPTIONS[type]}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className="dashboard-fab"
          onClick={() => setShowPicker((s) => !s)}
          aria-label="Add widget"
        >
          <Plus /> Add widget
        </button>
      </div>
    </div>
  );
}
