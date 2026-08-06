import { useEffect, useState, type FormEvent } from "react";
import type { Phase, Project, PullRequestState, Task, TaskCreate, TaskNote, TaskPriority, TaskStatus, User } from "@taskforge/contracts";
import { Check, ExternalLink, GitBranch, GitPullRequest, Link2, Send, Sparkles, Trash2, X } from "lucide-react";
import { priorityMeta, statusMeta } from "../lib/ui";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";
import { SendToAI } from "./SendToAI";

export function TaskModal({ task, initialStatus, defaultPhaseId, project, currentUser, members, phases, tasks, onClose, onSave, onDelete }: {
  task: Task | null; initialStatus: TaskStatus; defaultPhaseId: string | null; project: Project; currentUser: User; members: User[]; phases: Phase[]; tasks: Task[];
  onClose: () => void; onSave: (input: TaskCreate) => Promise<void>; onDelete: (() => Promise<void>) | null;
}) {
  const [form, setForm] = useState<TaskCreate>({ title: "", description: "", definitionOfDone: "", status: initialStatus, priority: "MEDIUM", assigneeId: null, parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: defaultPhaseId, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [updates, setUpdates] = useState<TaskNote[]>([]);
  const [updateBody, setUpdateBody] = useState("");
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showSendToAI, setShowSendToAI] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({ title: task.title, description: task.description, definitionOfDone: task.definitionOfDone, status: task.status, priority: task.priority, assigneeId: task.assigneeId, parentId: task.parentId, branch: task.branch, dueDate: task.dueDate, estimatePoints: task.estimatePoints, phaseId: task.phaseId, pullRequestUrl: task.pullRequestUrl, pullRequestTitle: task.pullRequestTitle, pullRequestState: task.pullRequestState });
      api.taskUpdates(task.id).then(({ updates: taskUpdates }) => setUpdates(taskUpdates)).catch(() => setUpdates([]));
    } else setUpdates([]);
  }, [task]);

  const set = <K extends keyof TaskCreate>(key: K, value: TaskCreate[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave(form); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save task"); }
    finally { setSaving(false); }
  }
  async function postUpdate() {
    if (!task || !updateBody.trim()) return;
    setPostingUpdate(true); setError("");
    try {
      const { update } = await api.addTaskUpdate(task.id, updateBody);
      setUpdates((items) => [update, ...items]); setUpdateBody("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not post update"); }
    finally { setPostingUpdate(false); }
  }
  async function copyTaskLink() {
    if (!task) return;
    const url = new URL(window.location.href);
    url.search = ""; url.searchParams.set("project", project.key); url.searchParams.set("task", `${project.key}-${task.number}`);
    await navigator.clipboard.writeText(url.toString()); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1800);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="task-modal" onSubmit={submit}>
        <header><div><span className="modal-kicker">{task ? `${project.key}-${task.number}` : `New task in ${project.name}`}</span><h2>{task ? "Edit task" : "Create a task"}</h2></div><div className="modal-header-actions">{task && <button type="button" className="send-to-ai-button" onClick={() => setShowSendToAI(true)}><Sparkles /> Send to AI</button>}{task && <button type="button" className="copy-task-link" onClick={() => copyTaskLink().catch(() => setError("Could not copy task link"))}>{linkCopied ? <Check /> : <Link2 />}{linkCopied ? "Copied" : "Copy link"}</button>}<button type="button" className="icon-button" onClick={onClose}><X /></button></div></header>
        <div className="modal-grid">
          <div className="modal-main">
            <label>Task name<input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" required /></label>
            <label>Description<textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Add context, requirements, or useful links…" rows={5} /></label>
            <label>Definition of done<textarea value={form.definitionOfDone} onChange={(e) => set("definitionOfDone", e.target.value)} placeholder="Describe the observable outcome that marks this complete…" rows={4} /></label>
            <section className="pr-editor">
              <div className="section-heading"><span><GitPullRequest /> Pull request</span>{form.pullRequestUrl && <a href={form.pullRequestUrl} target="_blank" rel="noreferrer">Open PR <ExternalLink /></a>}</div>
              <label>PR URL<input type="url" value={form.pullRequestUrl ?? ""} onChange={(e) => { const url = e.target.value || null; set("pullRequestUrl", url); if (url && !form.pullRequestState) set("pullRequestState", "OPEN"); if (!url) { set("pullRequestTitle", null); set("pullRequestState", null); } }} placeholder="https://github.com/org/repo/pull/123" /></label>
              <div className="pr-fields-row"><label>PR title<input value={form.pullRequestTitle ?? ""} onChange={(e) => set("pullRequestTitle", e.target.value || null)} placeholder="What does this PR change?" disabled={!form.pullRequestUrl} /></label><label>State<select value={form.pullRequestState ?? "OPEN"} onChange={(e) => set("pullRequestState", e.target.value as PullRequestState)} disabled={!form.pullRequestUrl}><option value="DRAFT">Draft</option><option value="OPEN">Open</option><option value="MERGED">Merged</option><option value="CLOSED">Closed</option></select></label></div>
            </section>
          </div>
          <aside className="modal-fields">
            <label>Phase<select value={form.phaseId ?? ""} onChange={(e) => set("phaseId", e.target.value || null)}><option value="">No phase</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>Phase {phase.number}{phase.isActive ? " · Active" : ""}</option>)}</select></label>
            <label>Status<select value={form.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
            <label>Assignee<select value={form.assigneeId ?? ""} onChange={(e) => set("assigneeId", e.target.value || null)}><option value="">Unassigned</option>{members.map((user) => <option key={user.id} value={user.id}>{user.name}{user.kind === "AGENT" ? " (Agent)" : ""}</option>)}</select></label>
            <label>Priority<select value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>{Object.entries(priorityMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
            <label>Parent task<select value={form.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}><option value="">None</option>{tasks.filter((candidate) => candidate.id !== task?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{project.key}-{candidate.number} · {candidate.title}</option>)}</select></label>
            <label>Due date<input type="date" value={form.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} /></label>
            <label>Estimate<input type="number" min="0" max="100" value={form.estimatePoints ?? ""} onChange={(e) => set("estimatePoints", e.target.value ? Number(e.target.value) : null)} placeholder="Points" /></label>
            <label>Branch<div className="input-icon"><GitBranch /><input value={form.branch ?? ""} onChange={(e) => set("branch", e.target.value || null)} placeholder="feature/my-branch" /></div></label>
          </aside>
        </div>
        {task && <section className="task-updates">
          <div className="section-heading"><span>Updates <b>{updates.length}</b></span></div>
          <div className="update-composer"><Avatar user={currentUser} size="md" /><textarea value={updateBody} onChange={(e) => setUpdateBody(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void postUpdate(); } }} rows={2} placeholder="Share progress, a decision, or a blocker…" /><button type="button" className="button button-primary" disabled={!updateBody.trim() || postingUpdate} onClick={postUpdate}><Send /> {postingUpdate ? "Posting…" : "Post update"}</button></div>
          <div className="update-list">{updates.length ? updates.map((update) => <article className="task-update" key={update.id}><Avatar user={update.author} size="md" /><div><header><strong>{update.author.name}{update.author.kind === "AGENT" && <em>Agent</em>}</strong><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.createdAt))}</time></header><p>{update.body}</p></div></article>) : <p className="updates-empty">No updates yet. Add the first progress note above.</p>}</div>
        </section>}
        {error && <div className="form-error">{error}</div>}
        <footer>{onDelete ? <button type="button" className="button button-danger-quiet" onClick={onDelete}><Trash2 /> Delete</button> : <span />}<div><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? "Saving…" : task ? "Save changes" : "Create task"}</button></div></footer>
        {showSendToAI && task && <SendToAI project={project} task={task} phaseNumber={phases.find((phase) => phase.id === task.phaseId)?.number ?? null} onClose={() => setShowSendToAI(false)} />}
      </form>
    </div>
  );
}
