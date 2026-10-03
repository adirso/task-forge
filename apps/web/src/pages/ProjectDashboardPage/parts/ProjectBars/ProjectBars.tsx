import { WidgetEmpty } from "../../../../components/WidgetShell";
import type { ProjectBarsProps } from "./types";
import styles from "./ProjectBars.module.css";

export function ProjectBars({ rows, empty, format = String }: ProjectBarsProps) {
  const max = Math.max(0, ...rows.map((row) => row.value));
  if (!max) return <WidgetEmpty>{empty}</WidgetEmpty>;
  return (
    <ul className={styles.root} aria-label="Chart values">
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`}>
          <div>
            <span>{row.label}</span>
            <strong>{format(row.value)}</strong>
          </div>
          <div className={styles.track} aria-hidden="true">
            <span style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
