import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import type { ActivityEvent, AgentArtifact, AgentPlan, AgentRunInterventionAction, Attachment, Task, TaskCreate, TaskNote } from "@taskforge/contracts";
import { Activity, Check, FileText, Link2, ListTree, Sparkles, Terminal, Trash2, X } from "lucide-react";
import { api, type AgentCycleState, type AgentLog, type AgentRun } from "../../lib/api";
import { SendToAI } from "../SendToAI";
import { selectAIPromptMode, type AIPromptMode } from "../../lib/aiPrompt";
import { canForceCycle, FORCE_CYCLE_FAILURE_MESSAGE, forceCycleRequestId } from "../../lib/cycleLimit";
import type { TaskModalProps, TaskModalTab } from "./types";
import { DetailsPanel } from "./parts/DetailsPanel";
import { UpdatesPanel } from "./parts/UpdatesPanel";
import { PlansPanel } from "./parts/PlansPanel";
import { AgentsPanel } from "./parts/AgentsPanel";
import styles from "./TaskModal.module.css";

export function TaskModal({ task, initialStatus, defaultPhaseId, project, currentUser, members, phases, availableTags, tasks, onClose, onSave, onDelete, onRouted, onPlanApplied }: TaskModalProps) {
  const [form, setForm] = useState<TaskCreate>({ title: "", description: "", definitionOfDone: "", status: initialStatus, priority: "MEDIUM", type: "FEATURE", assigneeId: null, parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: defaultPhaseId, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, tags: [], dependencyIds: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TaskModalTab>("details");
  const [updates, setUpdates] = useState<TaskNote[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [cycle, setCycle] = useState<AgentCycleState | null>(null);
  const [forcingCycle, setForcingCycle] = useState(false);
  const [controllingRun, setControllingRun] = useState<string | null>(null);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [runAgents, setRunAgents] = useState<Record<string, string>>({});
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [plans, setPlans] = useState<AgentPlan[]>([]);
  const [reviewingPlan, setReviewingPlan] = useState<string | null>(null);
  const [updateBody, setUpdateBody] = useState("");
  const [postingUpdate, setPostingUpdate] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [aiMode, setAIMode] = useState<AIPromptMode | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? []);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const [routingSkills, setRoutingSkills] = useState("");
  const [routing, setRouting] = useState(false);

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
        const [updatesResult, runsResult, logsResult, plansResult, artifactsResult] = await Promise.allSettled([api.taskUpdates(task.id), api.taskRuns(task.id), api.taskAgentLogs(task.id), api.taskPlans(task.id), api.taskArtifacts(task.id)]);
        if (updatesResult.status === "fulfilled") setUpdates(updatesResult.value.updates);
        if (runsResult.status === "fulfilled") { setRuns(runsResult.value.runs); setCycle(runsResult.value.cycle); }
        if (logsResult.status === "fulfilled") setAgentLogs(logsResult.value.agentLogs);
        if (plansResult.status === "fulfilled") setPlans(plansResult.value.plans);
        if (artifactsResult.status === "fulfilled") setArtifacts(artifactsResult.value.artifacts);
        setObservedAt(Date.now());
      };
      api.taskAttachments(task.id).then(({ attachments: taskAttachments }) => setAttachments(taskAttachments)).catch(() => setAttachments(task.attachments ?? []));
      api.taskActivity(task.id).then(({ activity: events }) => setActivity(events)).catch(() => setActivity([]));
      void refreshObservability();
      const timer = window.setInterval(() => { void refreshObservability(); }, 5000);
      const clock = window.setInterval(() => setObservedAt(Date.now()), 1000);
      return () => { window.clearInterval(timer); window.clearInterval(clock); };
    } else { setUpdates([]); setAttachments([]); setActivity([]); setRuns([]); setCycle(null); setAgentLogs([]); setPlans([]); setArtifacts([]); }
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
  async function autoRoute() {
    if (!task) return;
    setRouting(true); setError("");
    try {
      const result = await api.routeTask(task.id, { requiredSkills: routingSkills.split(",").map((value) => value.trim()).filter(Boolean) });
      set("assigneeId", result.selectedAgentId);
      onRouted?.(result.task);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not route task"); }
    finally { setRouting(false); }
  }
  async function forceCycle() {
    if (!task || !cycle || !canForceCycle(currentUser, project, cycle)) return;
    if (!window.confirm(`Force one additional autonomous delivery cycle for ${project.key}-${task.number}? The safety limit will increase from ${cycle.limit} to ${cycle.limit + 1}.`)) return;
    setForcingCycle(true); setError("");
    try {
      const result = await api.forceTaskCycle(task.id, forceCycleRequestId(task.id, cycle.count));
      setCycle(result.cycle);
      const refreshedActivity = await api.taskActivity(task.id).catch(() => null);
      if (refreshedActivity) setActivity(refreshedActivity.activity);
    } catch { setError(FORCE_CYCLE_FAILURE_MESSAGE); }
    finally { setForcingCycle(false); }
  }
  async function controlRun(run: AgentRun, action: AgentRunInterventionAction) {
    const input = runInputs[run.id]?.trim();
    const agentId = runAgents[run.id] || run.assignedAgentId || undefined;
    if (action === "ANSWER" && !input) { setError("Enter an answer before resuming the run"); return; }
    if (action === "REASSIGN" && !agentId) { setError("Choose an agent before reassigning the run"); return; }
    if ((action === "CANCEL" || action === "TAKEOVER") && !window.confirm(action === "TAKEOVER" ? "Stop this agent run and take ownership of the task?" : "Cancel this agent run?")) return;
    setControllingRun(run.id); setError("");
    try {
      const result = await api.interveneRun(run.id, crypto.randomUUID(), { action, controlVersion: run.controlVersion, ...(action === "ANSWER" ? { input } : {}), ...(action === "REASSIGN" ? { agentId } : {}) });
      setRuns((items) => items.map((candidate) => candidate.id === run.id ? result.run : candidate));
      if (action === "ANSWER") setRunInputs((items) => ({ ...items, [run.id]: "" }));
      const refreshedActivity = task ? await api.taskActivity(task.id).catch(() => null) : null;
      if (refreshedActivity) setActivity(refreshedActivity.activity);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not control agent run"); }
    finally { setControllingRun(null); }
  }
  async function reviewPlan(plan: AgentPlan, action: "APPROVE" | "REJECT") {
    if (!task || !canControlRuns) return;
    if (action === "REJECT" && !window.confirm(`Reject plan v${plan.version}? The proposal will remain in history.`)) return;
    setReviewingPlan(plan.id); setError("");
    try {
      const result = await api.decideTaskPlan(task.id, plan.id, { action });
      setPlans((items) => items.map((item) => item.id === plan.id ? result.plan : item));
      const refreshedPlans = await api.taskPlans(task.id).catch(() => null);
      if (refreshedPlans) setPlans(refreshedPlans.plans);
      if (action === "APPROVE" && onPlanApplied) {
        try { await onPlanApplied(); }
        catch { setError("Plan approved, but the task list could not be refreshed"); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not review the plan"); }
    finally { setReviewingPlan(null); }
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
  async function downloadArtifact(artifact: AgentArtifact) { try { const blob = await api.downloadAgentArtifact(artifact.id); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = artifact.name; link.click(); URL.revokeObjectURL(url); } catch (err) { setError(err instanceof Error ? err.message : "Could not download agent artifact"); } }
  async function removeAttachment(attachment: Attachment) { try { await api.deleteTaskAttachment(attachment.id); setAttachments((items) => items.filter((item) => item.id !== attachment.id)); } catch (err) { setError(err instanceof Error ? err.message : "Could not remove attachment"); } }

  const headerTitle = form.title.trim() || (task ? "Untitled task" : "New task");
  const runningAgents = runs.filter((run) => run.status === "RUNNING" || run.status === "PENDING").length;
  const canControlRuns = currentUser.kind === "HUMAN" && (currentUser.role === "ADMIN" || currentUser.id === project.ownerId);
  const tasksById = new Map(tasks.map((candidate) => [candidate.id, candidate]));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={styles.root} role="dialog" aria-modal="true" aria-labelledby="task-modal-title" onSubmit={submit}>
        <header>
          <div className={styles.headerCopy}>
            <span className="modal-kicker">{task ? `${project.key}-${task.number}` : `New task in ${project.name}`}</span>
            <h2 id="task-modal-title" title={headerTitle}>{headerTitle}</h2>
          </div>
          <div className={styles.headerActions}>
            {task && <>
              <button type="button" className={styles.sendToAI} onClick={() => setAIMode(selectAIPromptMode(project, task))}><Sparkles /> Send to AI</button>
              <button type="button" className={styles.copyLink} onClick={() => copyTaskLink().catch(() => setError("Could not copy task link"))}>{linkCopied ? <Check /> : <Link2 />}{linkCopied ? "Copied" : "Copy link"}</button>
            </>}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
          </div>
        </header>
        <nav className={styles.tabs} role="tablist" aria-label="Task sections">
          <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}><FileText /> Details & information</button>
          <button type="button" role="tab" aria-selected={tab === "updates"} className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")} disabled={!task}><Activity /> Updates & activity{task ? <b>{updates.length + activity.length}</b> : null}</button>
          <button type="button" role="tab" aria-selected={tab === "plans"} className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")} disabled={!task}><ListTree /> Plans{task ? <b>{plans.length}</b> : null}</button>
          <button type="button" role="tab" aria-selected={tab === "agents"} className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")} disabled={!task}><Terminal /> Agents{task ? <b>{runs.length || agentLogs.length ? `${runs.length}${runningAgents ? ` · ${runningAgents} live` : ""}` : "0"}</b> : null}</button>
        </nav>
        <div className={styles.body}>
          {tab === "details" && (
            <DetailsPanel
              task={task}
              form={form}
              initialStatus={initialStatus}
              project={project}
              currentUser={currentUser}
              members={members}
              phases={phases}
              availableTags={availableTags}
              tasks={tasks}
              attachments={attachments}
              draggingFiles={draggingFiles}
              uploadingFiles={uploadingFiles}
              routingSkills={routingSkills}
              routing={routing}
              set={set}
              setRoutingSkills={setRoutingSkills}
              setDraggingFiles={setDraggingFiles}
              onDrop={onDrop}
              onUploadFiles={uploadFiles}
              onDownloadAttachment={downloadAttachment}
              onRemoveAttachment={removeAttachment}
              onAutoRoute={autoRoute}
            />
          )}
          {tab === "updates" && task && (
            <UpdatesPanel
              currentUser={currentUser}
              updates={updates}
              activity={activity}
              runs={runs}
              agentLogs={agentLogs}
              observedAt={observedAt}
              updateBody={updateBody}
              postingUpdate={postingUpdate}
              setUpdateBody={setUpdateBody}
              onPostUpdate={postUpdate}
            />
          )}
          {tab === "plans" && task && (
            <PlansPanel
              project={project}
              plans={plans}
              tasksById={tasksById}
              canControlRuns={canControlRuns}
              reviewingPlan={reviewingPlan}
              onReviewPlan={reviewPlan}
            />
          )}
          {tab === "agents" && task && (
            <AgentsPanel
              project={project}
              currentUser={currentUser}
              members={members}
              runs={runs}
              cycle={cycle}
              agentLogs={agentLogs}
              artifacts={artifacts}
              observedAt={observedAt}
              forcingCycle={forcingCycle}
              controllingRun={controllingRun}
              runInputs={runInputs}
              runAgents={runAgents}
              canControlRuns={canControlRuns}
              runningAgents={runningAgents}
              setRunInputs={setRunInputs}
              setRunAgents={setRunAgents}
              onForceCycle={forceCycle}
              onControlRun={controlRun}
              onDownloadArtifact={downloadArtifact}
            />
          )}
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
