import { useMemo, useState } from "react";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";
import { getCompactor } from "react-grid-layout/core";
import { GridBackground } from "react-grid-layout/extras";
import type { Layout } from "react-grid-layout";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Bot,
  CheckSquare,
  LayoutDashboard,
  Plus,
  RotateCcw,
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
  DEFAULT_WIDGET_SIZE,
  findNextSlot,
  GRID_COLS,
  GRID_MARGIN,
  GRID_PADDING,
  GRID_ROW_HEIGHT,
  loadLayout,
  makeWidgetId,
  resetLayout,
  saveLayout,
  WIDGET_DESCRIPTIONS,
  WIDGET_LABELS,
  type DashboardLayout,
  type WidgetType,
} from "../lib/dashboard";
import type { User } from "@taskforge/contracts";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

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

const gridCompactor = getCompactor(null, false, true);

const GRID_CONFIG = {
  cols: GRID_COLS,
  rowHeight: GRID_ROW_HEIGHT,
  margin: GRID_MARGIN,
  containerPadding: GRID_PADDING,
};

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
  const { width, containerRef, mounted } = useContainerWidth();
  const [layout, setLayout] = useState(() => loadLayout(currentUser.role === "ADMIN"));
  const [showPicker, setShowPicker] = useState(false);
  const isMobile = width > 0 && width < 700;

  const gridLayout = useMemo<Layout>(
    () => layout.widgets.map((widget) => {
      const size = DEFAULT_WIDGET_SIZE[widget.type];
      return {
        i: widget.id,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        minW: size.minW,
        minH: size.minH,
      };
    }),
    [layout.widgets],
  );

  const gridRows = Math.max(
    8,
    layout.widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0) + 2,
  );
  const mobileWidgets = useMemo(
    () => [...layout.widgets].sort((a, b) => (a.y - b.y) || (a.x - b.x)),
    [layout.widgets],
  );

  function persist(next: DashboardLayout) {
    setLayout(next);
    saveLayout(next);
  }

  function addWidget(type: WidgetType) {
    const size = DEFAULT_WIDGET_SIZE[type];
    const slot = findNextSlot(layout.widgets, size.w, size.h);
    persist({
      version: 2,
      widgets: [...layout.widgets, { id: makeWidgetId(), type, ...size, ...slot }],
    });
    setShowPicker(false);
  }

  function removeWidget(id: string) {
    persist({ version: 2, widgets: layout.widgets.filter((widget) => widget.id !== id) });
  }

  function handleResetLayout() {
    if (!window.confirm("Reset the dashboard to the default layout? Your current widget arrangement will be lost.")) {
      return;
    }
    persist(resetLayout(currentUser.role === "ADMIN"));
    setShowPicker(false);
  }

  function handleLayoutChange(next: Layout) {
    const byId = new Map(next.map((item) => [item.i, item]));
    const unchanged = layout.widgets.every((widget) => {
      const item = byId.get(widget.id);
      return item && item.x === widget.x && item.y === widget.y && item.w === widget.w && item.h === widget.h;
    });
    if (unchanged && next.length === layout.widgets.length) return;
    persist({
      version: 2,
      widgets: layout.widgets.map((widget) => {
        const item = byId.get(widget.id);
        if (!item) return widget;
        return { ...widget, x: item.x, y: item.y, w: item.w, h: item.h };
      }),
    });
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-canvas" ref={containerRef}>
        {layout.widgets.length === 0 && (
          <div className="dashboard-empty">
            <LayoutDashboard />
            <h3>Your dashboard is empty</h3>
            <p>Click <strong>+ Add widget</strong> to get started.</p>
          </div>
        )}

        {mounted && !isMobile && (
          <>
            <GridBackground
              width={width}
              cols={GRID_COLS}
              rowHeight={GRID_ROW_HEIGHT}
              margin={GRID_MARGIN}
              containerPadding={GRID_PADDING}
              rows={gridRows}
              color="#e8eaed"
              borderRadius={12}
              className="dashboard-grid-bg"
            />
            <ReactGridLayout
              width={width}
              layout={gridLayout}
              gridConfig={GRID_CONFIG}
              dragConfig={{ enabled: true, handle: ".widget-drag-handle", bounded: true }}
              resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
              compactor={gridCompactor}
              onLayoutChange={handleLayoutChange}
              className="dashboard-grid"
            >
              {layout.widgets.map((widget) => (
                <div key={widget.id} className="dashboard-grid-item">
                  <WidgetShell
                    type={widget.type}
                    icon={WIDGET_ICONS[widget.type]}
                    onClose={() => removeWidget(widget.id)}
                  >
                    {renderWidgetContent(widget.type, currentUser)}
                  </WidgetShell>
                </div>
              ))}
            </ReactGridLayout>
          </>
        )}
        {mounted && isMobile && (
          <div className="dashboard-mobile-list">
            {mobileWidgets.map((widget) => (
              <div key={widget.id} className="dashboard-mobile-item">
                <WidgetShell
                  type={widget.type}
                  icon={WIDGET_ICONS[widget.type]}
                  onClose={() => removeWidget(widget.id)}
                >
                  {renderWidgetContent(widget.type, currentUser)}
                </WidgetShell>
              </div>
            ))}
          </div>
        )}
      </div>

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
          className="dashboard-fab-reset"
          onClick={handleResetLayout}
          aria-label="Reset layout"
        >
          <RotateCcw /> Reset layout
        </button>
        <button
          type="button"
          className="dashboard-fab"
          onClick={() => setShowPicker((open) => !open)}
          aria-label="Add widget"
        >
          <Plus /> Add widget
        </button>
      </div>
    </div>
  );
}
