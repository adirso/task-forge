import { useState, type FormEvent } from "react";
import type { Phase } from "@taskforge/contracts";
import { AlertTriangle, Trash2, X } from "lucide-react";

export type PhaseDeleteDisposition =
  | { taskAction?: undefined; targetPhaseId?: undefined }
  | { taskAction: "move"; targetPhaseId: string }
  | { taskAction: "delete" };

export function PhaseDeleteModal({
  phase,
  alternatives,
  onClose,
  onConfirm,
}: {
  phase: Phase;
  alternatives: Phase[];
  onClose: () => void;
  onConfirm: (disposition: PhaseDeleteDisposition) => Promise<void>;
}) {
  const taskCount = phase.taskCount ?? 0;
  const hasTasks = taskCount > 0;
  const canMove = alternatives.length > 0;
  const [taskAction, setTaskAction] = useState<"move" | "delete">(canMove ? "move" : "delete");
  const [targetPhaseId, setTargetPhaseId] = useState(alternatives[0]?.id ?? "");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = !hasTasks || taskAction === "delete" || (taskAction === "move" && Boolean(targetPhaseId));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setDeleting(true);
    setError("");
    try {
      if (!hasTasks) await onConfirm({});
      else if (taskAction === "move") await onConfirm({ taskAction: "move", targetPhaseId });
      else await onConfirm({ taskAction: "delete" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete phase");
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onClose(); }}>
      <form className="delete-project-modal" onSubmit={submit}>
        <header>
          <span className="delete-warning-icon"><AlertTriangle /></span>
          <button type="button" className="icon-button" onClick={onClose} disabled={deleting} aria-label="Close"><X /></button>
        </header>
        <h2>Delete Phase {phase.number}?</h2>
        <p>{hasTasks
          ? `This phase has ${taskCount} ${taskCount === 1 ? "task" : "tasks"}. Choose what should happen to them before the phase is removed.`
          : "This phase has no tasks and can be deleted safely."}</p>
        <div className="delete-project-summary">
          <span className="phase-number">{phase.number}</span>
          <span><strong>Phase {phase.number}</strong><small>{phase.goal}</small></span>
        </div>
        {hasTasks && (
          <fieldset className="phase-delete-options">
            <legend>What should happen to the tasks?</legend>
            <label className={`phase-delete-choice${taskAction === "move" ? " selected" : ""}${!canMove ? " disabled" : ""}`}>
              <input type="radio" name="task-action" value="move" checked={taskAction === "move"} disabled={!canMove || deleting} onChange={() => setTaskAction("move")} />
              <span>
                <strong>Move tasks to another phase</strong>
                <small>{canMove ? "Keep the work and attach it to a different phase." : "No other phase is available to receive these tasks."}</small>
              </span>
            </label>
            {taskAction === "move" && canMove && (
              <label className="phase-delete-target">
                Destination phase
                <select value={targetPhaseId} onChange={(event) => setTargetPhaseId(event.target.value)} disabled={deleting}>
                  {alternatives.map((item) => <option key={item.id} value={item.id}>Phase {item.number}{item.isActive ? " · Active" : ""}</option>)}
                </select>
              </label>
            )}
            <label className={`phase-delete-choice${taskAction === "delete" ? " selected" : ""}`}>
              <input type="radio" name="task-action" value="delete" checked={taskAction === "delete"} disabled={deleting} onChange={() => setTaskAction("delete")} />
              <span>
                <strong>Delete the tasks</strong>
                <small>Permanently remove every task in this phase. This cannot be undone.</small>
              </span>
            </label>
          </fieldset>
        )}
        {error && <div className="form-error">{error}</div>}
        <footer>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={deleting}>Cancel</button>
          <button className="button button-delete" disabled={!canSubmit || deleting}>
            <Trash2 /> {deleting ? "Deleting…" : hasTasks && taskAction === "delete" ? "Delete phase and tasks" : "Delete phase"}
          </button>
        </footer>
      </form>
    </div>
  );
}
