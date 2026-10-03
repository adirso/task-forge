export interface ProjectBarsProps {
  rows: Array<{ label: string; value: number }>;
  empty: string;
  format?: (value: number) => string;
}
