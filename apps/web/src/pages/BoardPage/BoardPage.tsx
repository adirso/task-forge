import { Flag, Plus } from "lucide-react";
import { PhaseBanner } from "./parts/PhaseBanner";
import { BoardColumns } from "./parts/BoardColumns";
import type { BoardPageProps } from "./types";
import styles from "./BoardPage.module.css";

export function BoardPage({
  project,
  phases,
  selectedPhase,
  tasks,
  hasTasksInSelectedPhase,
  currentUser,
  onPhaseChange,
  onOpen,
  onCreate,
  onMove,
  onManagePhases,
  onMergePhase,
}: BoardPageProps) {
  if (!selectedPhase) {
    return (
      <div className={styles.root}>
        <div className={styles.noActive}>
          <Flag />
          <div>
            <strong>No active phase</strong>
            <span>Choose an active phase to populate the board.</span>
          </div>
          <button type="button" className="button button-primary" onClick={onManagePhases}>Manage phases</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <PhaseBanner
        project={project}
        phases={phases}
        selectedPhase={selectedPhase}
        taskCount={tasks.length}
        currentUser={currentUser}
        onPhaseChange={onPhaseChange}
        onManagePhases={onManagePhases}
        onMergePhase={onMergePhase}
      />
      {hasTasksInSelectedPhase ? (
        <BoardColumns tasks={tasks} project={project} onOpen={onOpen} onCreate={onCreate} onMove={onMove} />
      ) : (
        <div className={styles.empty}>
          <Flag />
          <strong>No tasks in Phase {selectedPhase.number}</strong>
          <span>This phase is ready for its first task.</span>
          <button type="button" className="button button-primary" onClick={() => onCreate(project.defaultStatus)}>
            <Plus /> Create task
          </button>
        </div>
      )}
    </div>
  );
}
