import { ChevronDown } from "lucide-react";
import { canMergePhaseToMain } from "../../../../lib/phaseMerge";
import type { PhaseBannerProps } from "./types";
import styles from "./PhaseBanner.module.css";

export function PhaseBanner({
  project,
  phases,
  selectedPhase,
  taskCount,
  currentUser,
  onPhaseChange,
  onManagePhases,
  onMergePhase,
}: PhaseBannerProps) {
  const showMerge = project.mergeTarget === "phase"
    && selectedPhase.isActive
    && (currentUser.role === "ADMIN" || currentUser.id === project.ownerId);
  const canMerge = canMergePhaseToMain(project.mergeTarget, selectedPhase.nonDoneTaskCount ?? 0);

  return (
    <div className={`${styles.banner}${selectedPhase.isActive ? "" : ` ${styles.viewing}`}`}>
      <span className={styles.badge}>{selectedPhase.number}</span>
      <div className={styles.copy}>
        <span>{selectedPhase.isActive ? "Active phase" : "Viewing phase"}</span>
        <strong>Phase {selectedPhase.number}</strong>
        <p>{selectedPhase.goal}</p>
      </div>
      <label className={styles.selector}>
        <span>Board phase</span>
        <div>
          <select aria-label="Board phase" value={selectedPhase.id} onChange={(event) => onPhaseChange(event.target.value)}>
            {[...phases].sort((a, b) => a.number - b.number).map((phase) => (
              <option key={phase.id} value={phase.id}>
                Phase {phase.number}{phase.isActive ? " · Active" : ""}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
      </label>
      <small>{taskCount} {taskCount === 1 ? "task" : "tasks"}</small>
      {showMerge && (
        <button type="button" className="button button-secondary" disabled={!canMerge} onClick={onMergePhase}>
          {canMerge ? "Merge phase to main" : "Complete tasks to merge"}
        </button>
      )}
      <button type="button" className="button button-secondary" onClick={onManagePhases}>Manage phases</button>
    </div>
  );
}
