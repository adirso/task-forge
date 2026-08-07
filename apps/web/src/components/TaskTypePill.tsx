import type { TaskType } from "@taskforge/contracts";
import { taskTypeMeta } from "../lib/ui";

export function TaskTypePill({ type }: { type: TaskType }) {
  const { label, icon: Icon } = taskTypeMeta[type];
  return <span className={`type-pill type-${type.toLowerCase()}`} title={`Type: ${label}`}><Icon /> {label}</span>;
}
