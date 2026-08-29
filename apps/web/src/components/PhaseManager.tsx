import { useState, type FormEvent } from "react";
import type { Phase, Project } from "@taskforge/contracts";
import { CheckCircle2, Flag, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { PhaseDeleteModal, type PhaseDeleteDisposition } from "./PhaseDeleteModal";
import { canMergePhaseToMain } from "../lib/phaseMerge";

export type PhaseListChange = {
  phases: Phase[];
  deletedPhaseId?: string;
  taskAction?: "move" | "delete";
  targetPhaseId?: string;
};

export function PhasesPage({ project, phases, currentUser, onChange }: {
  project: Project;
  phases: Phase[];
  currentUser: { id: string; role: "ADMIN" | "MEMBER" };
  onChange: (change: PhaseListChange) => void;
}) {
  const nextNumber = Math.max(0, ...phases.map((phase) => phase.number)) + 1;
  const [number, setNumber] = useState(nextNumber);
  const [goal, setGoal] = useState("");
  const [makeActive, setMakeActive] = useState(phases.length === 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Phase | null>(null);
  const activePhase = phases.find((phase) => phase.isActive);
  const nonDoneTasks = phases.reduce((sum, phase) => sum + (phase.nonDoneTaskCount ?? 0), 0);
  const cancelledTasks = phases.reduce((sum, phase) => sum + (phase.cancelledTaskCount ?? 0), 0);
  const nonDonePhases = phases.filter((phase) => (phase.nonDoneTaskCount ?? 0) > 0).length;

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const { phase } = await api.createPhase(project.id, { number, goal, isActive: makeActive });
      onChange({ phases: [phase, ...phases.map((item) => makeActive ? { ...item, isActive: false } : item)] });
      setNumber(number + 1); setGoal(""); setMakeActive(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create phase"); }
    finally { setSaving(false); }
  }
  async function activate(phaseId: string) {
    try {
      const { phase } = await api.updatePhase(phaseId, { isActive: true });
      onChange({
        phases: phases.map((item) => item.id === phase.id
          ? { ...phase, taskCount: item.taskCount, nonDoneTaskCount: item.nonDoneTaskCount, completedTaskCount: item.completedTaskCount, cancelledTaskCount: item.cancelledTaskCount }
          : { ...item, isActive: false }),
      });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not activate phase"); }
  }
  async function confirmDelete(disposition: PhaseDeleteDisposition) {
    if (!pendingDelete) return;
    const phase = pendingDelete;
    await api.deletePhase(phase.id, disposition);
    const remaining = phases.filter((item) => item.id !== phase.id);
    let nextPhases = remaining;
    if (disposition.taskAction === "move" && disposition.targetPhaseId) {
      const movedCount = phase.taskCount ?? 0;
      const movedNonDone = phase.nonDoneTaskCount ?? 0;
      const movedDone = phase.completedTaskCount ?? 0;
      const movedCancelled = phase.cancelledTaskCount ?? 0;
      nextPhases = remaining.map((item) => item.id === disposition.targetPhaseId
        ? {
          ...item,
          taskCount: (item.taskCount ?? 0) + movedCount,
          nonDoneTaskCount: (item.nonDoneTaskCount ?? 0) + movedNonDone,
          completedTaskCount: (item.completedTaskCount ?? 0) + movedDone,
          cancelledTaskCount: (item.cancelledTaskCount ?? 0) + movedCancelled,
        }
        : item);
    }
    if (phase.isActive && nextPhases.length) {
      const replacement = [...nextPhases].sort((a, b) => b.number - a.number)[0]!;
      nextPhases = nextPhases.map((item) => ({ ...item, isActive: item.id === replacement.id }));
    }
    onChange({
      phases: nextPhases,
      deletedPhaseId: phase.id,
      ...(disposition.taskAction === "move"
        ? { taskAction: "move" as const, targetPhaseId: disposition.targetPhaseId }
        : disposition.taskAction === "delete"
          ? { taskAction: "delete" as const }
          : {}),
    });
    setPendingDelete(null);
  }

  return (
    <div className="phases-page">
      <div className="phases-overview"><div><span className="modal-kicker">Planning</span><h2>Project phases</h2><p>Organize delivery windows and choose which phase supplies work to the board.</p></div><div className="phase-stats"><span><strong>{nonDonePhases}</strong>Non-done phases</span><span><strong>{nonDoneTasks}</strong>Non-done tasks</span><span><strong>{cancelledTasks}</strong>Cancelled tasks</span><span><strong>{activePhase ? `#${activePhase.number}` : "—"}</strong>Active</span></div></div>
      <div className="phases-page-layout"><section><div className="phase-page-section-title"><h3>All phases</h3><span>{project.name}</span></div><div className="phase-list">{phases.map((phase) => <article key={phase.id} className={phase.isActive ? "active" : ""}><span className="phase-number">{phase.number}</span><div><span><strong>Phase {phase.number}</strong>{phase.isActive && <em><CheckCircle2 /> Active</em>}</span><p>{phase.goal}</p><small>{phase.nonDoneTaskCount ?? 0} non-done · {phase.completedTaskCount ?? 0} done · {phase.cancelledTaskCount ?? 0} cancelled</small></div><div>{project.mergeTarget === "phase" && currentUser && (currentUser.role === "ADMIN" || currentUser.id === project.ownerId) && <button className="button button-secondary" disabled={!canMergePhaseToMain(project.mergeTarget, phase.nonDoneTaskCount ?? 0)} onClick={async () => { try { await api.ensurePhaseBranch(project.id, phase.id); await api.mergePhaseToMain(project.id, phase.id); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Could not merge phase"); } }}>{canMergePhaseToMain(project.mergeTarget, phase.nonDoneTaskCount ?? 0) ? "Merge phase to main" : "Complete tasks to merge"}</button>}{!phase.isActive && <button className="button button-secondary" onClick={() => activate(phase.id)}>Set active</button>}<button className="phase-delete" onClick={() => setPendingDelete(phase)} aria-label={`Delete Phase ${phase.number}`}><Trash2 /></button></div></article>)}</div>{!phases.length && <div className="phases-empty"><Flag /><strong>No phases yet</strong><span>Create the first phase using the form.</span></div>}</section>
        <aside><form className="new-phase-form" onSubmit={create}><h3><Plus /> Add a phase</h3><p>Create the next planning window and optionally make it active immediately.</p><div className="new-phase-fields"><label>Number<input type="number" min="1" value={number} onChange={(event) => setNumber(Number(event.target.value))} required /></label><label>Goal<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this phase accomplish?" required /></label></div><label className="checkbox-label"><input type="checkbox" checked={makeActive} onChange={(event) => setMakeActive(event.target.checked)} /><Flag /> Make this the active phase</label>{error && <div className="form-error">{error}</div>}<footer><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create phase"}</button></footer></form></aside></div>
      {pendingDelete && <PhaseDeleteModal phase={pendingDelete} alternatives={phases.filter((phase) => phase.id !== pendingDelete.id)} onClose={() => setPendingDelete(null)} onConfirm={confirmDelete} />}
    </div>
  );
}
