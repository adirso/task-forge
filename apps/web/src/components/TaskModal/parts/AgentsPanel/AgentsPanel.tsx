import { Download, Paperclip, Sparkles, Terminal } from "lucide-react";
import { artifactProvenance, artifactTypeLabel } from "../../../../lib/agentArtifacts";
import { canForceCycle } from "../../../../lib/cycleLimit";
import { formatCountdown, getRunHealth, latestRunLog, runIsWaitingForInput, runLogs } from "../../../../lib/runObservability";
import type { AgentLog } from "../../../../lib/api";
import type { AgentsPanelProps } from "./types";
import styles from "./AgentsPanel.module.css";

const runStatusClass: Record<string, string | undefined> = {
  running: styles.statusRunning,
  pending: styles.statusPending,
  succeeded: styles.statusSucceeded,
  failed: styles.statusFailed,
  cancelled: styles.statusCancelled,
};

const runHealthClass: Record<string, string | undefined> = {
  live: styles.healthLive,
  waiting: styles.healthWaiting,
  paused: styles.healthPaused,
  waiting_for_input: styles.healthWaitingForInput,
  stale: styles.healthStale,
  timed_out: styles.healthTimedOut,
  failed: styles.healthFailed,
  completed: styles.healthCompleted,
  cancelled: styles.healthCancelled,
};

export function AgentsPanel({
  project,
  currentUser,
  members,
  runs,
  cycle,
  agentLogs,
  artifacts,
  observedAt,
  forcingCycle,
  controllingRun,
  runInputs,
  runAgents,
  canControlRuns,
  runningAgents,
  setRunInputs,
  setRunAgents,
  onForceCycle,
  onControlRun,
  onDownloadArtifact,
}: AgentsPanelProps) {
  const liveProvider = latestProviderLog(agentLogs);

  return (
    <section className={styles.root}>
      {runs.length || agentLogs.length || artifacts.length || liveProvider ? (
        <>
          {canForceCycle(currentUser, project, cycle) && (
            <div className={styles.forceCycle} role="alert">
              <span>
                <strong>Autonomous cycle limit reached</strong>
                <small>{cycle!.count} of {cycle!.limit} delivery cycles have been used. An owner or administrator may authorize exactly one more.</small>
              </span>
              <button type="button" className="button button-danger-quiet" onClick={() => void onForceCycle()} disabled={forcingCycle}>
                <Sparkles /> {forcingCycle ? "Starting…" : "Force one additional cycle"}
              </button>
            </div>
          )}
          {liveProvider && (
            <div className={styles.providerProgress}>
              <Terminal />
              <span>
                <strong>Live provider progress</strong>
                <small>{liveProvider.provider} · {liveProvider.stream} · #{liveProvider.sequence}</small>
                <pre>{liveProvider.content}</pre>
              </span>
            </div>
          )}
          <section className={styles.runs}>
            <div className="section-heading">
              <span>Agent runs <b>{runs.length}</b></span>
              <small>{runningAgents ? "Live · refreshes every 5s" : ""}</small>
            </div>
            {runs.length ? (
              <div className={styles.runList}>
                {runs.map((run) => {
                  const health = getRunHealth(run, observedAt);
                  const lastLog = latestRunLog(agentLogs, run.id);
                  const timeline = runLogs(agentLogs, run.id);
                  const timeout = formatCountdown(run.timeoutAt, observedAt);
                  const busy = controllingRun === run.id;
                  const terminal = run.status === "SUCCEEDED" || run.status === "CANCELLED";
                  return (
                    <article className={`${styles.runItem}${health.stale ? ` ${styles.stale}` : ""}`} key={run.id}>
                      <div className={styles.runItemHeader}>
                        <strong>{run.kind}</strong>
                        <span className={`${styles.runStatus} ${runStatusClass[run.status.toLowerCase()] ?? ""}`}>{run.status}</span>
                        <span className={`${styles.runHealth} ${runHealthClass[health.kind.toLowerCase()] ?? ""}`}>{health.label}</span>
                        <time>{formatDate(run.updatedAt)}</time>
                      </div>
                      <div className={styles.healthDetail}>
                        {health.detail}
                        {run.controlState === "ACTIVE" && runIsWaitingForInput(lastLog) && <b className={styles.waiting}>Possible unstructured input request</b>}
                      </div>
                      <div className={styles.runItemMeta}>
                        <span>Attempts {run.attemptCount}/{run.maxAttempts}</span>
                        <span>Decision v{run.controlVersion}</span>
                        {run.heartbeatAt && <span>Heartbeat {formatDate(run.heartbeatAt)}</span>}
                        {run.leaseExpiresAt && run.status === "RUNNING" && <span>Lease until {formatDate(run.leaseExpiresAt)}</span>}
                        {timeout && <span>Timeout {timeout}</span>}
                      </div>
                      {run.controlState === "WAITING_FOR_INPUT" && (
                        <div className={styles.inputRequest}>
                          <strong>Provider question</strong>
                          <p>{run.inputRequest}</p>
                          {canControlRuns && (
                            <textarea
                              aria-label={`Answer ${run.kind} run`}
                              rows={2}
                              value={runInputs[run.id] ?? ""}
                              onChange={(event) => setRunInputs((items) => ({ ...items, [run.id]: event.target.value }))}
                              placeholder="Provide the decision or missing information"
                            />
                          )}
                        </div>
                      )}
                      {canControlRuns && !terminal && run.controlState !== "HUMAN_TAKEOVER" && (
                        <div className={styles.controls} aria-label={`${run.kind} run controls`}>
                          {run.controlState === "ACTIVE" && ["PENDING", "RUNNING"].includes(run.status) && (
                            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void onControlRun(run, "PAUSE")}>Pause</button>
                          )}
                          {run.controlState === "PAUSED" && (
                            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void onControlRun(run, "RESUME")}>Resume</button>
                          )}
                          {run.controlState === "WAITING_FOR_INPUT" && (
                            <button type="button" className="button button-primary" disabled={busy || !runInputs[run.id]?.trim()} onClick={() => void onControlRun(run, "ANSWER")}>Answer &amp; resume</button>
                          )}
                          {run.status === "FAILED" && run.attemptCount < run.maxAttempts && (
                            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void onControlRun(run, "RETRY")}>Retry</button>
                          )}
                          <label>
                            Reassign
                            <select
                              aria-label={`Reassign ${run.kind} run`}
                              value={runAgents[run.id] ?? run.assignedAgentId ?? ""}
                              onChange={(event) => setRunAgents((items) => ({ ...items, [run.id]: event.target.value }))}
                            >
                              <option value="">Choose agent</option>
                              {members.filter((member) => member.kind === "AGENT").map((member) => (
                                <option key={member.id} value={member.id}>{member.name}</option>
                              ))}
                            </select>
                          </label>
                          <button type="button" className="button button-secondary" disabled={busy || !(runAgents[run.id] || run.assignedAgentId)} onClick={() => void onControlRun(run, "REASSIGN")}>Apply</button>
                          <button type="button" className="button button-danger-quiet" disabled={busy} onClick={() => void onControlRun(run, "CANCEL")}>Cancel run</button>
                          <button type="button" className="button button-danger-quiet" disabled={busy} onClick={() => void onControlRun(run, "TAKEOVER")}>Take over</button>
                        </div>
                      )}
                      {timeline.length > 0 && (
                        <div className={styles.outputTimeline} aria-label={`${run.kind} provider response timeline`}>
                          <small>Provider response timeline · {timeline.length} event{timeline.length === 1 ? "" : "s"}</small>
                          {timeline.slice().reverse().map((log) => (
                            <div className={styles.timelineEntry} key={log.id}>
                              <span>#{log.sequence} · {log.stream}</span>
                              <pre>{log.content}</pre>
                            </div>
                          ))}
                        </div>
                      )}
                      {run.lastError && <p className={styles.runError}>{run.lastError}</p>}
                    </article>
                  );
                })}
              </div>
            ) : <p className={styles.runsEmpty}>No agent runs yet.</p>}
          </section>
          <section className={`${styles.artifacts} task-agent-artifacts`}>
            <div className="section-heading">
              <span><Paperclip /> Evidence &amp; provenance <b>{artifacts.length}</b></span>
              <small>Immutable, SHA-bound run artifacts</small>
            </div>
            {artifacts.length ? (
              <div className={styles.artifactList}>
                {artifacts.map((artifact) => (
                  <button type="button" className={styles.artifact} aria-label={`Download ${artifact.name}`} onClick={() => void onDownloadArtifact(artifact)} key={artifact.id}>
                    <span>
                      <strong>{artifact.name}</strong>
                      <small>{artifactTypeLabel(artifact.type)} · run {artifact.runId.slice(0, 12)}</small>
                    </span>
                    <code>{artifactProvenance(artifact)}</code>
                    <Download />
                  </button>
                ))}
              </div>
            ) : <p className={styles.logsEmpty}>No structured evidence recorded yet.</p>}
          </section>
          <section className={styles.logs}>
            <div className="section-heading">
              <span><Terminal /> Agent logs <b>{agentLogs.length}</b></span>
              <small>Provider output and callbacks</small>
            </div>
            {agentLogs.length ? (
              <div className={styles.logList}>
                {agentLogs.map((log) => (
                  <article className={styles.logEntry} key={log.id}>
                    <header>
                      <strong>{log.provider}</strong>
                      <span>#{log.sequence} · {log.stream} · {log.category}</span>
                      <time>{formatDate(log.createdAt)}</time>
                    </header>
                    <pre>{log.content}</pre>
                  </article>
                ))}
              </div>
            ) : <p className={styles.logsEmpty}>No provider logs yet.</p>}
          </section>
        </>
      ) : (
        <div className={styles.empty}>
          <span>
            <Terminal />
            <strong>No agent activity yet</strong>
            <small>Runs and provider logs will show up here when an agent is sent to this task.</small>
          </span>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function latestProviderLog(logs: AgentLog[]): AgentLog | null {
  return logs.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.sequence - a.sequence)[0] ?? null;
}
