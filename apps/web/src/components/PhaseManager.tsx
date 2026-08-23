import { useState, type FormEvent } from "react";
import type { Phase, Project } from "@taskforge/contracts";
import { CheckCircle2, Flag, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";

export function PhasesPage({ project, phases, onChange }: { project: Project; phases: Phase[]; onChange: (phases: Phase[]) => void }) {
  const nextNumber = Math.max(0, ...phases.map((phase) => phase.number)) + 1;
  const [number, setNumber] = useState(nextNumber);
  const [goal, setGoal] = useState("");
  const [makeActive, setMakeActive] = useState(phases.length === 0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const activePhase = phases.find((phase) => phase.isActive);
  const totalTasks = phases.reduce((sum, phase) => sum + (phase.taskCount ?? 0), 0);

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const { phase } = await api.createPhase(project.id, { number, goal, isActive: makeActive });
      onChange([phase, ...phases.map((item) => makeActive ? { ...item, isActive: false } : item)]); setNumber(number + 1); setGoal(""); setMakeActive(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create phase"); }
    finally { setSaving(false); }
  }
  async function activate(phaseId: string) {
    try { const { phase } = await api.updatePhase(phaseId, { isActive: true }); onChange(phases.map((item) => item.id === phase.id ? { ...phase, taskCount: item.taskCount, completedTaskCount: item.completedTaskCount, cancelledTaskCount: item.cancelledTaskCount } : { ...item, isActive: false })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not activate phase"); }
  }
  async function remove(phase: Phase) {
    if (!window.confirm(`Delete Phase ${phase.number}? Its tasks will become unassigned from a phase.`)) return;
    try { await api.deletePhase(phase.id); onChange(phases.filter((item) => item.id !== phase.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete phase"); }
  }

  return (
    <div className="phases-page">
      <div className="phases-overview"><div><span className="modal-kicker">Planning</span><h2>Project phases</h2><p>Organize delivery windows and choose which phase supplies work to the board.</p></div><div className="phase-stats"><span><strong>{phases.length}</strong>Phases</span><span><strong>{totalTasks}</strong>Planned tasks</span><span><strong>{activePhase ? `#${activePhase.number}` : "—"}</strong>Active</span></div></div>
      <div className="phases-page-layout"><section><div className="phase-page-section-title"><h3>All phases</h3><span>{project.name}</span></div><div className="phase-list">{phases.map((phase) => <article key={phase.id} className={phase.isActive ? "active" : ""}><span className="phase-number">{phase.number}</span><div><span><strong>Phase {phase.number}</strong>{phase.isActive && <em><CheckCircle2 /> Active</em>}</span><p>{phase.goal}</p><small>{phase.taskCount ?? 0} {(phase.taskCount ?? 0) === 1 ? "task" : "tasks"} · {phase.completedTaskCount ?? 0} done · {phase.cancelledTaskCount ?? 0} cancelled</small></div><div>{!phase.isActive && <button className="button button-secondary" onClick={() => activate(phase.id)}>Set active</button>}<button className="phase-delete" onClick={() => remove(phase)} aria-label={`Delete Phase ${phase.number}`}><Trash2 /></button></div></article>)}</div>{!phases.length && <div className="phases-empty"><Flag /><strong>No phases yet</strong><span>Create the first phase using the form.</span></div>}</section>
        <aside><form className="new-phase-form" onSubmit={create}><h3><Plus /> Add a phase</h3><p>Create the next planning window and optionally make it active immediately.</p><div className="new-phase-fields"><label>Number<input type="number" min="1" value={number} onChange={(event) => setNumber(Number(event.target.value))} required /></label><label>Goal<input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="What should this phase accomplish?" required /></label></div><label className="checkbox-label"><input type="checkbox" checked={makeActive} onChange={(event) => setMakeActive(event.target.checked)} /><Flag /> Make this the active phase</label>{error && <div className="form-error">{error}</div>}<footer><button className="button button-primary" disabled={saving}>{saving ? "Creating…" : "Create phase"}</button></footer></form></aside></div>
    </div>
  );
}
