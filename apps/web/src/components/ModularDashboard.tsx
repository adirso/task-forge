import { useMemo, useState, type ReactNode } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import { getCompactor } from "react-grid-layout/core";
import { GridBackground } from "react-grid-layout/extras";
import { LayoutDashboard, Plus, RotateCcw, X } from "lucide-react";
import { WidgetShell } from "./WidgetShell";
import { findNextSlot, makeWidgetId, GRID_COLS, GRID_MARGIN, GRID_PADDING, GRID_ROW_HEIGHT } from "../lib/dashboard";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export interface ModuleLayout<T extends string> {
  version: 2;
  widgets: Array<{ id: string; type: T; x: number; y: number; w: number; h: number }>;
}
interface Props<T extends string> {
  catalog: Record<T, { label: string; description: string; icon: ReactNode; w: number; h: number; minW: number; minH: number }>;
  load: () => ModuleLayout<T>;
  save: (layout: ModuleLayout<T>) => void;
  defaults: () => ModuleLayout<T>;
  render: (type: T) => ReactNode;
}
const gridCompactor = getCompactor(null, false, true);
const GRID_CONFIG = { cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: GRID_MARGIN, containerPadding: GRID_PADDING };

export function ModularDashboard<T extends string>({ catalog, load, save, defaults, render }: Props<T>) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [layout, setLayout] = useState(() => load());
  const [showPicker, setShowPicker] = useState(false);
  const isMobile = width > 0 && width < 700;

  const gridLayout = useMemo<Layout>(
    () => layout.widgets.map((widget) => {
      const size = catalog[widget.type];
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
    [layout.widgets, catalog],
  );

  const gridRows = Math.max(
    8,
    layout.widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0) + 2,
  );
  const mobileWidgets = useMemo(
    () => [...layout.widgets].sort((a, b) => (a.y - b.y) || (a.x - b.x)),
    [layout.widgets],
  );

  function persist(next: ModuleLayout<T>) {
    setLayout(next);
    save(next);
  }

  function addWidget(type: T) {
    const { w, h } = catalog[type];
    const size = { w, h };
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
    persist(defaults());
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
                    title={catalog[widget.type].label}
                    icon={catalog[widget.type].icon}
                    onClose={() => removeWidget(widget.id)}
                  >
                    {render(widget.type)}
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
                  title={catalog[widget.type].label}
                  icon={catalog[widget.type].icon}
                  onClose={() => removeWidget(widget.id)}
                >
                  {render(widget.type)}
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
              <button type="button" onClick={() => setShowPicker(false)} className="widget-picker-close" aria-label="Close widget picker"><X /></button>
            </div>
            <div className="widget-picker-list">
              {(Object.keys(catalog) as T[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className="widget-picker-item"
                  onClick={() => addWidget(type)}
                >
                  <span className="widget-picker-icon">{catalog[type].icon}</span>
                  <span className="widget-picker-text">
                    <strong>{catalog[type].label}</strong>
                    <small>{catalog[type].description}</small>
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
