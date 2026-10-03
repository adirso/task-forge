import { Download, ExternalLink, FileText, GitBranch, GitPullRequest, Image, Paperclip, Sparkles, UploadCloud, X } from "lucide-react";
import type { PullRequestState, TaskPriority, TaskStatus, TaskType } from "@taskforge/contracts";
import { priorityMeta, statusMeta, taskTypeMeta } from "../../../../lib/ui";
import { TaskTagEditor } from "../../../TaskTags";
import { TaskDependencyEditor } from "../../../TaskDependencies";
import type { DetailsPanelProps } from "./types";
import styles from "./DetailsPanel.module.css";

export function DetailsPanel({
  task,
  form,
  initialStatus,
  project,
  currentUser,
  members,
  phases,
  availableTags,
  tasks,
  attachments,
  draggingFiles,
  uploadingFiles,
  routingSkills,
  routing,
  set,
  setRoutingSkills,
  setDraggingFiles,
  onDrop,
  onUploadFiles,
  onDownloadAttachment,
  onRemoveAttachment,
  onAutoRoute,
}: DetailsPanelProps) {
  return (
    <div className={styles.grid}>
      <div className={styles.main}>
        <label>Task name<input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs to be done?" required /></label>
        <label>Description<textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Add context, requirements, or useful links…" rows={5} /></label>
        <label>Definition of done<textarea value={form.definitionOfDone} onChange={(e) => set("definitionOfDone", e.target.value)} placeholder="Describe the observable outcome that marks this complete…" rows={4} /></label>
        <section className={`${styles.dependencyField} ${styles.dependencySection}`}>
          <div className="section-heading"><span>Dependencies</span></div>
          <TaskDependencyEditor value={form.dependencyIds ?? []} tasks={tasks} projectKey={project.key} currentTaskId={task?.id} resolutionStatuses={project.dependencyResolutionStatuses} onChange={(dependencyIds) => set("dependencyIds", dependencyIds)} />
        </section>
        {task && (
          <section className={styles.attachments}>
            <div className="section-heading"><span><Paperclip /> Attachments <b>{attachments.length}</b></span></div>
            <div
              className={`${styles.dropzone}${draggingFiles ? ` ${styles.dragging}` : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDraggingFiles(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => { if (event.currentTarget === event.target) setDraggingFiles(false); }}
              onDrop={onDrop}
            >
              <UploadCloud />
              <strong>{uploadingFiles ? "Uploading…" : "Drop files here"}</strong>
              <span>PDFs, documents, and photos up to 25 MB</span>
              <label className={`button button-secondary ${styles.browse}`}>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={(event) => { if (event.target.files) void onUploadFiles(event.target.files); event.currentTarget.value = ""; }}
                />
                Browse files
              </label>
            </div>
            {attachments.length > 0 && (
              <div className={styles.attachmentList}>
                {attachments.map((attachment) => (
                  <article className={styles.attachmentItem} key={attachment.id}>
                    <span className={styles.attachmentIcon}>{attachment.mimeType.startsWith("image/") ? <Image /> : <FileText />}</span>
                    <span>
                      <strong title={attachment.fileName}>{attachment.fileName}</strong>
                      <small>{formatBytes(attachment.size)} · {attachment.uploadedBy.name}</small>
                    </span>
                    <button type="button" title="Download attachment" onClick={() => void onDownloadAttachment(attachment)}><Download /></button>
                    <button type="button" title="Remove attachment" onClick={() => void onRemoveAttachment(attachment)}><X /></button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        <section className={styles.prEditor}>
          <div className="section-heading">
            <span><GitPullRequest /> Pull request</span>
            {form.pullRequestUrl && <a href={form.pullRequestUrl} target="_blank" rel="noreferrer">Open PR <ExternalLink /></a>}
          </div>
          <label>
            PR URL
            <input
              type="url"
              value={form.pullRequestUrl ?? ""}
              onChange={(e) => {
                const url = e.target.value || null;
                set("pullRequestUrl", url);
                if (url && !form.pullRequestState) set("pullRequestState", "OPEN");
                if (!url) { set("pullRequestTitle", null); set("pullRequestState", null); }
              }}
              placeholder="https://github.com/org/repo/pull/123"
            />
          </label>
          <div className={styles.prFieldsRow}>
            <label>PR title<input value={form.pullRequestTitle ?? ""} onChange={(e) => set("pullRequestTitle", e.target.value || null)} placeholder="What does this PR change?" disabled={!form.pullRequestUrl} /></label>
            <label>
              State
              <select value={form.pullRequestState ?? "OPEN"} onChange={(e) => set("pullRequestState", e.target.value as PullRequestState)} disabled={!form.pullRequestUrl}>
                <option value="DRAFT">Draft</option>
                <option value="OPEN">Open</option>
                <option value="MERGED">Merged</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
          </div>
        </section>
        {task?.statusDurations && Object.keys(task.statusDurations).length > 0 && (
          <StatusDurationBreakdown durations={task.statusDurations} currentStatus={task.status} statusOrder={project.availableStatuses ?? []} />
        )}
      </div>
      <aside className={styles.fields}>
        <div className={styles.tagField}>
          <span>Tags</span>
          <TaskTagEditor value={form.tags ?? []} availableTags={availableTags} onChange={(tags) => set("tags", tags)} />
        </div>
        <label>Type<select value={form.type} onChange={(e) => set("type", e.target.value as TaskType)}>{Object.entries(taskTypeMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
        <label>Phase<select value={form.phaseId ?? ""} onChange={(e) => set("phaseId", e.target.value || null)}><option value="">No phase</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>Phase {phase.number}{phase.isActive ? " · Active" : ""}</option>)}</select></label>
        <label>Status<select aria-label="Task status" value={form.status ?? initialStatus} onChange={(e) => set("status", e.target.value as TaskStatus)}>{project.availableStatuses.map((status) => <option key={status} value={status}>{statusMeta[status].label}</option>)}</select></label>
        <label>Assignee<select value={form.assigneeId ?? ""} onChange={(e) => set("assigneeId", e.target.value || null)}><option value="">Unassigned</option>{members.map((user) => <option key={user.id} value={user.id}>{user.name}{user.kind === "AGENT" ? " (Agent)" : ""}</option>)}</select></label>
        {task && currentUser.kind === "HUMAN" && (currentUser.role === "ADMIN" || currentUser.id === project.ownerId) && (
          <div className={styles.routingControl}>
            <label>Required agent skills<input value={routingSkills} onChange={(event) => setRoutingSkills(event.target.value)} placeholder="typescript, security" /></label>
            <button type="button" className="button button-secondary" disabled={routing} onClick={() => void onAutoRoute()}><Sparkles /> {routing ? "Routing…" : "Auto-route"}</button>
            <small>Chooses an available project agent by capability and capacity. Selecting an assignee above is the operator override.</small>
          </div>
        )}
        <label>Priority<select aria-label="Task priority" value={form.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>{Object.entries(priorityMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label>
        <label>Parent task<select value={form.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}><option value="">None</option>{tasks.filter((candidate) => candidate.id !== task?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{project.key}-{candidate.number} · {candidate.title}</option>)}</select></label>
        <label>Due date<input type="date" value={form.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} /></label>
        <label>Estimate<input type="number" min="0" max="100" value={form.estimatePoints ?? ""} onChange={(e) => set("estimatePoints", e.target.value ? Number(e.target.value) : null)} placeholder="Points" /></label>
        <label>Branch<div className={styles.inputIcon}><GitBranch /><input value={form.branch ?? ""} onChange={(e) => set("branch", e.target.value || null)} placeholder="feature/my-branch" /></div></label>
      </aside>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    <section className={styles.statusDuration}>
      <div className="section-heading">
        <span>Time in status</span>
        <small>{formatDuration(total)} total</small>
      </div>
      <div className={styles.statusBar} role="img" aria-label="Time spent in each status">
        {entries.map(({ status, seconds }) => {
          const meta = statusMeta[status];
          const width = `${Math.max(2, (seconds / total) * 100)}%`;
          return <span key={status} className={meta?.tone ?? "slate"} style={{ width }} title={`${meta?.label ?? status}: ${formatDuration(seconds)}`} />;
        })}
      </div>
      <ul className={styles.statusDurationList}>
        {entries.map(({ status, seconds }) => {
          const meta = statusMeta[status];
          const isCurrent = status === currentStatus;
          return (
            <li key={status} className={isCurrent ? styles.current : undefined}>
              <span className={styles.statusDurationLabel}>
                <span className={`status-dot ${meta?.tone ?? "slate"}`} />
                <strong>{meta?.label ?? status}</strong>
                {isCurrent && <em>Now</em>}
              </span>
              <span className={styles.statusDurationMeta}>
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
