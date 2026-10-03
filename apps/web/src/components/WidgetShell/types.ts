import type { ReactNode } from "react";
import type { WidgetType } from "../../lib/dashboard";

export interface WidgetShellProps {
  type?: WidgetType;
  title?: string;
  icon: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export interface WidgetErrorProps {
  message: string;
  onRetry: () => void;
}

export interface WidgetLoadingProps {
  lines?: number;
}

export interface WidgetEmptyProps {
  children: ReactNode;
}
