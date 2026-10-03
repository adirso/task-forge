import { taskTypeMeta } from "../../lib/ui";
import type { TaskTypePillProps } from "./types";
import styles from "./TaskTypePill.module.css";

export function TaskTypePill({ type }: TaskTypePillProps) {
  const { label, icon: Icon } = taskTypeMeta[type];
  const typeClass = {
    FEATURE: styles.feature,
    BUG: styles.bug,
    INFRA: styles.infra,
    UPDATE: styles.update,
    SECURITY: styles.security,
    DOCS: styles.docs,
    CHORE: styles.chore,
  }[type];
  return (
    <span className={`${styles.root} ${typeClass}`} title={`Type: ${label}`}>
      <Icon /> {label}
    </span>
  );
}
