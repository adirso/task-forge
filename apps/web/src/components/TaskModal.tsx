import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import type { ActivityEvent, Attachment, Phase, Project, PullRequestState, Tag, Task, TaskCreate, TaskNote, TaskPriority, TaskStatus, TaskType, User } from "@taskforge/contracts";
import { Activity, Check, Download, ExternalLink, FileText, GitBranch, GitPullRequest, Image, Link2, Paperclip, Send, Sparkles, Terminal, Trash2, UploadCloud, X } from "lucide-react";
import { priorityMeta, statusMeta, taskTypeMeta } from "../lib/ui";
import { api, type AgentLog, type AgentRun } from "../lib/api";
import { Avatar } from "./Avatar";
import { SendToAI } from "./SendToAI";
import type { AIPromptMode } from "../lib/aiPrompt";
import { TaskTagEditor } from "./TaskTags";
import { TaskDependencyEditor } from "./TaskDependencies";
import { formatAge, formatCountdown, getRunHealth, latestRunLog, runIsWaitingForInput, runLogs } from "../lib/runObservability";

type TaskModalTab = "details" | "updates" | "agents";

export function TaskModal({ task, initialStatus, defaultPhaseId, project, currentUser, members, phases, availableTags, tasks, onClose, onSave, onDelete }: {
  task: Task | null; initialStatus: TaskStatus; defaultPhaseId: string | null; project: Project; currentUser: User; members: User[]; phases: Phase[]; availableTags: Tag[]; tasks: Task[];
  onClose: () => void; onSave: (input: TaskCreate) => Promise<void>; onDelete: (() => Promise<void>) | null;
}) {
  const [form, setForm] = useState<TaskCreate>({ title: "", description: "", definitionOfDone: "", status: initialStatus, priority: "MEDIUM", type: "FEATURE", assigneeId: null, parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: defaultPhaseId, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, tags: [], dependencyIds: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TaskModalTab>("details");
  const [updates, setUpdates] = useState<TaskNote[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [updateBody, setUpdateBody] = useState("");
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [aiMode, setAIMode] = useState<AIPromptMode | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? []);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    setTab("details");
    if (task) {
      setForm({ title: task.title, description: task.description, definitionOfDone: task.definitionOfDone, status: task.status, priority: task.priority, type: task.type, assigneeId: task.assigneeId, parentId: task.parentId, branch: task.branch, dueDate: task.dueDate, estimatePoints: task.estimatePoints, phaseId: task.phaseId, pullRequestUrl: task.pullRequestUrl, pullRequestTitle: task.pullRequestTitle, pullRequestState: task.pullRequestState, tags: task.tags.map((tag) => tag.name), dependencyIds: task.dependencies.map((dependency) => dependency.dependsOnTaskId) });
      const refreshObservability = async () => {
        const [updatesResult, runsResult, logsResult] = await Promise.allSettled([api.taskUpdates(task.id), api.taskRuns(task.id), api.taskAgentLogs(task.id)]);
        if (updatesResult.status === "fulfilled") setUpdates(updatesResult.value.updates);
        if (runsResult.status === "fulfilled") setRuns(runsResult.value.runs);
        if (logsResult.status === "fulfilled") setAgentLogs(logsResult.value.agentLogs);
        setObservedAt(Date.now());
      };
      api.taskAttachments(task.id).then(({ attachments: taskAttachments }) => setAttachments(taskAttachments)).catch(() => setAttachments(task.attachments ?? []));
      api.taskActivity(task.id).then(({ activity: events }) => setActivity(events)).catch(() => setActivity([]));
      void refreshObservability();
      const timer = window.setInterval(() => { void refreshObservability(); }, 5000);
      const clock = window.setInterval(() => setObservedAt(Date.now()), 1000);
      return () => { window.clearInterval(timer); window.clearInterval(clock); };
    } else { setUpdates([]); setAttachments([]); setActivity([]); setRuns([]); setAgentLogs([]); }
  }, [task]);

  const set = <K extends keyof TaskCreate>(key: K, value: TaskCreate[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave({ ...form, status: form.status ?? initialStatus }); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Could not save task"); }
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
  async function uploadFiles(files: FileList | File[]) {
    if (!task || !files.length) return;
    setUploadingFiles(true); setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is larger than the 25 MB limit`);
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(`Could not read ${file.name}`)); reader.readAsDataURL(file); });
        const { attachment } = await api.uploadTaskAttachment(task.id, { fileName: file.name, mimeType: file.type || "application/octet-stream", data });
        setAttachments((items) => [attachment, ...items]);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not upload attachment"); }
    finally { setUploadingFiles(false); }
  }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDraggingFiles(false); void uploadFiles(event.dataTransfer.files); }
  async function downloadAttachment(attachment: Attachment) { try { const blob = await api.downloadTaskAttachment(attachment.id); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = attachment.fileName; link.click(); URL.revokeObjectURL(url); } catch (err) { setError(err instanceof Error ? err.message : "Could not download attachment"); } }
  async function removeAttachment(attachment: Attachment) { try { await api.deleteTaskAttachment(attachment.id); setAttachments((items) => items.filter((item) => item.id !== attachment.id)); } catch (err) { setError(err instanceof Error ? err.message : "Could not remove attachment"); } }

  const headerTitle = form.title.trim() || (task ? "Untitled task" : "New task");
  const liveProvider = latestProviderLog(agentLogs);
  const runningAgents = runs.filter((run) => run.status === "RUNNING" || run.status === "PENDING").length;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onSubmit={submit}>
        <header>
          <div className="modal-header-copy">
            <span className="modal-kicker">{task ? `${project.key}-${task.number}` : `New task in ${project.name}`}</span>
            <h2 id="task-modal-title" title={headerTitle}>{headerTitle}</h2>
          </div>
          <div className="modal-header-actions">
            {task && <>
              <button type="button" className="send-to-ai-button" onClick={() => setAIMode("IMPLEMENT")}><Sparkles /> Send to AI</button>
              <button type="button" className="copy-task-link" onClick={() => copyTaskLink().catch(() => setError("Could not copy task link"))}>{linkCopied ? <Check /> : <Link2 />}{linkCopied ? "Copied" : "Copy link"}</button>
            </>}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <nav className="task-modal-tabs" role="tablist" aria-label="Task sections">
          <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}><FileText /> Details & information</button>
          <button type="button" role="tab" aria-selected={tab === "updates"} className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")} disabled={!task}><Activity /> Updates & activity{task ? <b>{updates.length + activity.length}</b> : null}</button>
          <button type="button" role="tab" aria-selected={tab === "agents"} className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")} disabled={!task}><Terminal /> Agents{task ? <b>{runs.length || agentLogs.length ? `${runs.length}${runningAgents ? ` · ${runningAgents} live` : ""}` : "0"}</b> : null}</button>
        </nav>
        <div className="modal-body">
          {tab === "details" && <>
            <div className="modal-grid">
              <div className="modal-main">
                <label>Task name<input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" required /></label>
                <label>Description<textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Add context, requirements, or useful links…" rows={5} /></label>
                <label>Definition of done<textarea value={form.definitionOfDone} onChange={(e) => set("definitionOfDone", e.target.value)} placeholder="Describe the observable outcome that marks this complete…" rows={4} /></label>
                <section className="dependency-field dependency-section"><div className="section-heading"><span>Dependencies</span></div><TaskDependencyEditor value={form.dependencyIds ?? []} tasks={tasks} projectKey={project.key} currentTaskId={task?.id} onChange={(dependencyIds) => set("dependencyIds", dependencyIds)} /></section>
                {task && <section className="attachments-section"><div className="section-heading"><span><Paperclip /> Attachments <b>{attachments.length}</b></span></div><div className={`attachment-dropzone${draggingFiles ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFiles(false); }} onDrop={onDrop}><UploadCloud /><strong>{uploadingFiles ? "Uploading…" : "Drop files here"}</strong><span>PDFs, documents, and photos up to 25 MB</span><label className="button button-secondary attachment-browse"><input type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.currentTarget.value = ""; }} /> Browse files</label></div>{attachments.length > 0 && <div className="attachment-list">{attachments.map((attachment) => <article className="attachment-item" key={attachment.id}><span className="attachment-icon">{attachment.mimeType.startsWith("image/") ? <Image /> : <FileText />}</span><span><strong title={attachment.fileName}>{attachment.fileName}</strong><small>{formatBytes(attachment.size)} · {attachment.uploadedBy.name}</small></span><button type="button" title="Download attachment" onClick={() => void downloadAttachment(attachment)}><Download /></button><button type="button" title="Remove attachment" onClick={() => void removeAttachment(attachment)}><X /></button></article>)}</div>}</section>}
                <section className="pr-editor">
                  <div className="section-heading"><span><GitPullRequest /> Pull request</span>{form.pullRequestUrl && <a href={form.pullRequestUrl} target="_blank" rel="noreferrer">Open PR <ExternalLink /></a>}</div>
                  <label>PR URL<input type="url" value={form.pullRequestUrl ?? ""} onChange={(e) => { const url = e.target.value || null; set("pullRequestUrl", url); if (url && !form.pullRequestState) set("pullRequestState", "OPEN"); if (!url) { set("pullRequestTitle", null); set("pullRequestState", null); } }} placeholder="https://github.com/org/repo/pull/123" /></label>
                  <div className="pr-fields-row"><label>PR title<input value={form.pullRequestTitle ?? ""} onChange={(e) => set("pullRequestTitle", e.target.value || null)} placeholder="What does this PR change?" disabled={!form.pullRequestUrl} /></label><label>State<select value={form.pullRequestState ?? "OPEN"} onChange={(e) => set("pullRequestState", e.target.value as PullRequestState)} disabled={!form.pullRequestUrl}><option value="DRAFT">Draft</option><option value="OPEN">Open</option><option value="MERGED">Merged</option><option value="CLOSED">Closed</option></select></label></div>
                </section>
                {task?.statusDurations && Object.keys(task.statusDurations).length > 0 && <StatusDurationBreakdown durations={task.statusDurations} currentStatus={task.status} statusOrder={project.availableStatuses ?? []} />}
              </div>
              <aside className="modal-fields">
                <div className="tag-field"><span>Tags</span><TaskTagEditor value={form.tags ?? []} availableTags={availableTags} onChange={(tags) => set("tags", tags)} /></div>
                <label>Type<select value={form.type} onChange={(e) => set("type", e.target.value as TaskType)}>{Object.entries(taskTypeMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
                <label>Phase<select value={form.phaseId ?? ""} onChange={(e) => set("phaseId", e.target.value || null)}><option value="">No phase</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>Phase {phase.number}{phase.isActive ? " · Active" : ""}</option>)}</select></label>
                <label>Status<select aria-label="Task status" value={form.status ?? initialStatus} onChange={(e) => set("status", e.target.value as TaskStatus)}>{project.availableStatuses.map((status) => <option key={status} value={status}>{statusMeta[status].label}</option>)}</select></label>
                <label>Assignee<select value={form.assigneeId ?? ""} onChange={(e) => set("assigneeId", e.target.value || null)}><option value="">Unassigned</option>{members.map((user) => <option key={user.id} value={user.id}>{user.name}{user.kind === "AGENT" ? " (Agent)" : ""}</option>)}</select></label>
                <label>Priority<select aria-label="Task priority" value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>{Object.entries(priorityMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
                <label>Parent task<select value={form.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}><option value="">None</option>{tasks.filter((candidate) => candidate.id !== task?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{project.key}-{candidate.number} · {candidate.title}</option>)}</select></label>
                <label>Due date<input type="date" value={form.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} /></label>
                <label>Estimate<input type="number" min="0" max="100" value={form.estimatePoints ?? ""} onChange={(e) => set("estimatePoints", e.target.value ? Number(e.target.value) : null)} placeholder="Points" /></label>
                <label>Branch<div className="input-icon"><GitBranch /><input value={form.branch ?? ""} onChange={(e) => set("branch", e.target.value || null)} placeholder="feature/my-branch" /></div></label>
              </aside>
            </div>
          </>}
          {tab === "updates" && task && <section className="task-updates task-tab-panel">
            <div className="section-heading"><span>Updates <b>{updates.length}</b></span><small>{latestTaskActivity(updates, runs, agentLogs, observedAt)}</small></div>
            <div className="update-composer"><Avatar user={currentUser} size="md" /><textarea value={updateBody} onChange={(e) => setUpdateBody(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void postUpdate(); } }} rows={2} placeholder="Share progress, a decision, or a blocker…" /><button type="button" className="button button-primary" disabled={!updateBody.trim() || postingUpdate} onClick={postUpdate}><Send /> {postingUpdate ? "Posting…" : "Post update"}</button></div>
            <div className="update-list">{updates.length ? updates.map((update) => <article className="task-update" key={update.id}><Avatar user={update.author} size="md" /><div><header><strong>{update.author.name}{update.author.kind === "AGENT" && <em>Agent</em>}</strong><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.createdAt))}</time></header><p>{update.body}</p></div></article>) : <p className="updates-empty">No updates yet. Add the first progress note above.</p>}</div>
            <section className="task-activity">
              <div className="section-heading"><span>Activity log <b>{activity.length}</b></span></div>
              {activity.length ? <div className="activity-list">{activity.map((event) => <div className="activity-event" key={event.id}><span className="activity-dot" /><span className="activity-body"><strong>{event.actorName}</strong>{event.actorKind === "AGENT" && <em>Agent</em>}<span>{activityLabel(event.action, event.metadata)}</span><time>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</time></span></div>)}</div> : <p className="updates-empty">No activity recorded yet.</p>}
            </section>
          </section>}
          {tab === "agents" && task && <section className="task-agents task-tab-panel">
            {runs.length || agentLogs.length || liveProvider ? <>
              {liveProvider && <div className="task-provider-progress"><Terminal /><span><strong>Live provider progress</strong><small>{liveProvider.provider} · {liveProvider.stream} · #{liveProvider.sequence}</small><pre>{liveProvider.content}</pre></span></div>}
              <section className="task-runs">
                <div className="section-heading"><span>Agent runs <b>{runs.length}</b></span><small>{runningAgents ? "Live · refreshes every 5s" : ""}</small></div>
                {runs.length ? <div className="run-list">{runs.map((run) => { const health = getRunHealth(run, observedAt); const lastLog = latestRunLog(agentLogs, run.id); const timeline = runLogs(agentLogs, run.id); const timeout = formatCountdown(run.timeoutAt, observedAt); return <article className={`run-item${health.stale ? " is-stale" : ""}`} key={run.id}><div className="run-item-header"><strong>{run.kind}</strong><span className={`run-status run-status-${run.status.toLowerCase()}`}>{run.status}</span><span className={`run-health run-health-${health.kind.toLowerCase()}`}>{health.label}</span><time>{formatDate(run.updatedAt)}</time></div><div className="run-health-detail">{health.detail}{runIsWaitingForInput(lastLog) && <b className="run-waiting">Waiting for provider input</b>}</div><div className="run-item-meta"><span>Attempts {run.attemptCount}/{run.maxAttempts}</span>{run.heartbeatAt && <span>Heartbeat {formatDate(run.heartbeatAt)}</span>}{run.leaseExpiresAt && run.status === "RUNNING" && <span>Lease until {formatDate(run.leaseExpiresAt)}</span>}{timeout && <span>Timeout {timeout}</span>}</div>{timeline.length > 0 && <div className="run-output-timeline" aria-label={`${run.kind} provider response timeline`}><small>Provider response timeline · {timeline.length} event{timeline.length === 1 ? "" : "s"}</small>{timeline.slice().reverse().map((log) => <div className="run-timeline-entry" key={log.id}><span>#{log.sequence} · {log.stream}</span><pre>{log.content}</pre></div>)}</div>}{run.lastError && <p className="run-error">{run.lastError}</p>}</article>; })}</div> : <p className="runs-empty">No agent runs yet.</p>}
              </section>
              <section className="task-agent-logs">
                <div className="section-heading"><span><Terminal /> Agent logs <b>{agentLogs.length}</b></span><small>Provider output and callbacks</small></div>
                {agentLogs.length ? <div className="agent-log-list">{agentLogs.map((log) => <article className="agent-log-entry" key={log.id}><header><strong>{log.provider}</strong><span>#{log.sequence} · {log.stream} · {log.category}</span><time>{formatDate(log.createdAt)}</time></header><pre>{log.content}</pre></article>)}</div> : <p className="logs-empty">No provider logs yet.</p>}
              </section>
            </> : <div className="task-agents-empty"><span><Terminal /><strong>No agent activity yet</strong><small>Runs and provider logs will show up here when an agent is sent to this task.</small></span></div>}
          </section>}
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer>
          {onDelete ? <button type="button" className="button button-danger-quiet" onClick={onDelete}><Trash2 /> Delete</button> : <span />}
          <div>
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button className="button button-primary" disabled={saving}>{saving ? "Saving…" : task ? "Save changes" : "Create task"}</button>
          </div>
        </footer>
        {aiMode && task && <SendToAI project={project} task={task} phaseNumber={phases.find((phase) => phase.id === task.phaseId)?.number ?? null} initialMode={aiMode} onClose={() => setAIMode(null)} />}
      </form>
    </div>
  );
}

function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

function activityLabel(action: string, metadata: Record<string, unknown>): string {
  switch (action) {
    case "task.created": return "created this task";
    case "task.claimed": return "claimed this task";
    case "task.note_added": return "posted an update";
    case "task.updated": {
      const keys = Object.keys(metadata).filter((k) => k !== "updatedAt");
      if (keys.length === 1) {
        const key = keys[0]!;
        const labels: Record<string, string> = { status: "changed status", assigneeId: "changed assignee", priority: "changed priority", title: "renamed this task", branch: "set the branch", pullRequestUrl: "linked a PR", phaseId: "changed phase" };
        return labels[key] ?? `updated ${key}`;
      }
      return `updated ${keys.length} fields`;
    }
    default: return action.replace("task.", "").replace(/_/g, " ");
  }
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function StatusDurationBreakdown({ durations, currentStatus, statusOrder }: {
  durations: Partial<Record<TaskStatus, number>>;
  currentStatus: TaskStatus;
  statusOrder: TaskStatus[];
}) {
  const orderIndex = new Map(statusOrder.map((status, index) => [status, index]));
  const entries = Object.entries(durations)
    .map(([status, value]) => {
      const seconds = Number(value);
      return { status: status as TaskStatus, seconds: Number.isFinite(seconds) ? seconds : 0 };
    })
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => (orderIndex.get(a.status) ?? 999) - (orderIndex.get(b.status) ?? 999));
  const total = entries.reduce((sum, entry) => sum + entry.seconds, 0);
  if (!entries.length || total <= 0) return null;

  return (
    <section className="task-status-duration">
      <div className="section-heading">
        <span>Time in status</span>
        <small>{formatDuration(total)} total</small>
      </div>
      <div className="task-status-bar" role="img" aria-label="Time spent in each status">
        {entries.map(({ status, seconds }) => {
          const meta = statusMeta[status];
          const width = `${Math.max(2, (seconds / total) * 100)}%`;
          return <span key={status} className={meta?.tone ?? "slate"} style={{ width }} title={`${meta?.label ?? status}: ${formatDuration(seconds)}`} />;
        })}
      </div>
      <ul className="task-status-duration-list">
        {entries.map(({ status, seconds }) => {
          const meta = statusMeta[status];
          const isCurrent = status === currentStatus;
          return (
            <li key={status} className={isCurrent ? "is-current" : undefined}>
              <span className="task-status-duration-label">
                <span className={`status-dot ${meta?.tone ?? "slate"}`} />
                <strong>{meta?.label ?? status}</strong>
                {isCurrent && <em>Now</em>}
              </span>
              <span className="task-status-duration-meta">
                <b>{formatDuration(seconds)}</b>
                <small>{Math.round((seconds / total) * 100)}%</small>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }

function latestTaskActivity(updates: TaskNote[], runs: AgentRun[], logs: AgentLog[], now: number): string {
  const timestamps = [...updates.map((item) => Date.parse(item.createdAt)), ...runs.map((item) => Date.parse(item.updatedAt)), ...logs.map((item) => Date.parse(item.createdAt))].filter(Number.isFinite);
  if (!timestamps.length) return "No provider activity yet";
  return `Last activity ${formatAge(Math.max(0, now - Math.max(...timestamps)))} ago`;
}

function latestProviderLog(logs: AgentLog[]): AgentLog | null {
  return logs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.sequence - a.sequence)[0] ?? null;
}
