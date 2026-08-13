import { useRef } from "react";
import Draggable from "react-draggable";
import type { DraggableEventHandler } from "react-draggable";
import { X } from "lucide-react";
import type { WidgetType } from "../lib/dashboard";
import { WIDGET_LABELS } from "../lib/dashboard";

interface Props {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  onStop: (x: number, y: number) => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function WidgetShell({ id, type, x, y, icon, children, onClose, onStop, zIndex = 1, onFocus }: Props) {
  const nodeRef = useRef<HTMLDivElement>(null);

  const handleStop: DraggableEventHandler = (_e, data) => {
    onStop(Math.max(0, data.x), Math.max(0, data.y));
  };

  return (
    <Draggable
      nodeRef={nodeRef as React.RefObject<HTMLElement>}
      defaultPosition={{ x, y }}
      handle=".widget-drag-handle"
      onStop={handleStop}
      bounds={{ left: 0, top: 0 }}
    >
      <div
        ref={nodeRef}
        className="widget-card"
        style={{ zIndex, position: "absolute" }}
        onPointerDown={onFocus}
        data-widget-id={id}
      >
        <header className="widget-drag-handle">
          <span className="widget-header-icon">{icon}</span>
          <span className="widget-header-title">{WIDGET_LABELS[type]}</span>
          <button
            type="button"
            className="widget-close"
            aria-label={`Close ${WIDGET_LABELS[type]} widget`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="widget-body">{children}</div>
      </div>
    </Draggable>
  );
}
