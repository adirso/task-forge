import { useCallback, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { WIDGET_LABELS } from "../../lib/dashboard";
import { WidgetRefreshContext } from "../../lib/widgetQuery";
import type { WidgetEmptyProps, WidgetErrorProps, WidgetLoadingProps, WidgetShellProps } from "./types";
import styles from "./WidgetShell.module.css";

export function WidgetError({ message, onRetry }: WidgetErrorProps) {
  return (
    <div className={styles.error}>
      <span>{message}</span>
      <button type="button" className={styles.retry} onClick={onRetry}>Retry</button>
    </div>
  );
}

export function WidgetLoading({ lines = 3 }: WidgetLoadingProps) {
  return (
    <div className={styles.loading}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={styles.skeleton} />
      ))}
    </div>
  );
}

export function WidgetEmpty({ children }: WidgetEmptyProps) {
  return <div className={styles.empty}>{children}</div>;
}

export function WidgetShell({ type, title, icon, children, onClose }: WidgetShellProps) {
  const label = title ?? (type ? WIDGET_LABELS[type] : "Widget");
  const reloadRef = useRef<(() => void) | null>(null);
  const [canRefresh, setCanRefresh] = useState(false);

  const register = useCallback((reload: (() => void) | null) => {
    reloadRef.current = reload;
    setCanRefresh(Boolean(reload));
  }, []);

  return (
    <WidgetRefreshContext.Provider value={register}>
      <div className={styles.card}>
        <header className={`${styles.dragHandle} widget-drag-handle`}>
          <span className={styles.headerIcon}>{icon}</span>
          <span className={styles.headerTitle}>{label}</span>
          {canRefresh && (
            <button
              type="button"
              className={styles.refresh}
              aria-label={`Refresh ${label} widget`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => reloadRef.current?.()}
            >
              <RefreshCw />
            </button>
          )}
          <button
            type="button"
            className={styles.close}
            aria-label={`Close ${label} widget`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className={`${styles.body} widget-body`}>{children}</div>
      </div>
    </WidgetRefreshContext.Provider>
  );
}
