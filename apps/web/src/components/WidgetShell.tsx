import { useCallback, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { WidgetType } from "../lib/dashboard";
import { WIDGET_LABELS } from "../lib/dashboard";
import { WidgetRefreshContext } from "../lib/widgetQuery";

interface Props {
  type?: WidgetType;
  title?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}

export function WidgetError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="widget-error">
      <span>{message}</span>
      <button type="button" className="widget-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

export function WidgetShell({ type, title, icon, children, onClose }: Props) {
  const label = title ?? (type ? WIDGET_LABELS[type] : "Widget");
  const reloadRef = useRef<(() => void) | null>(null);
  const [canRefresh, setCanRefresh] = useState(false);

  const register = useCallback((reload: (() => void) | null) => {
    reloadRef.current = reload;
    setCanRefresh(Boolean(reload));
  }, []);

  return (
    <WidgetRefreshContext.Provider value={register}>
      <div className="widget-card">
        <header className="widget-drag-handle">
          <span className="widget-header-icon">{icon}</span>
          <span className="widget-header-title">{label}</span>
          {canRefresh && (
            <button
              type="button"
              className="widget-refresh"
              aria-label={`Refresh ${label} widget`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => reloadRef.current?.()}
            >
              <RefreshCw />
            </button>
          )}
          <button
            type="button"
            className="widget-close"
            aria-label={`Close ${label} widget`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="widget-body">{children}</div>
      </div>
    </WidgetRefreshContext.Provider>
  );
}
