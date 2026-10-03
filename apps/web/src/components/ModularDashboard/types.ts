import type { ReactNode } from "react";

export interface ModuleLayout<T extends string> {
  version: 2;
  widgets: Array<{ id: string; type: T; x: number; y: number; w: number; h: number }>;
}

export interface ModularDashboardProps<T extends string> {
  catalog: Record<T, { label: string; description: string; icon: ReactNode; w: number; h: number; minW: number; minH: number }>;
  load: () => ModuleLayout<T>;
  save: (layout: ModuleLayout<T>) => void;
  defaults: () => ModuleLayout<T>;
  render: (type: T) => ReactNode;
}
