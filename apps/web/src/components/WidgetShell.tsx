import { X } from "lucide-react";
import type { WidgetType } from "../lib/dashboard";
import { WIDGET_LABELS } from "../lib/dashboard";

interface Props {
  type: WidgetType;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}

export function WidgetShell({ type, icon, children, onClose }: Props) {
  return (
    <div className="widget-card">
      <header className="widget-drag-handle">
        <span className="widget-header-icon">{icon}</span>
        <span className="widget-header-title">{WIDGET_LABELS[type]}</span>
        <button
          type="button"
          className="widget-close"
          aria-label={`Close ${WIDGET_LABELS[type]} widget`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <div className="widget-body">{children}</div>
    </div>
  );
}
