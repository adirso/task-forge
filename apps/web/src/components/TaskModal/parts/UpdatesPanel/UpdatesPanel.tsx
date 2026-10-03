import { Send } from "lucide-react";
import { formatAge } from "../../../../lib/runObservability";
import { Avatar } from "../../../Avatar";
import type { UpdatesPanelProps } from "./types";
import styles from "./UpdatesPanel.module.css";

export function UpdatesPanel({
  currentUser,
  updates,
  activity,
  runs,
  agentLogs,
  observedAt,
  updateBody,
  postingUpdate,
  setUpdateBody,
  onPostUpdate,
}: UpdatesPanelProps) {
  return (
    <section className={styles.root}>
      <div className="section-heading">
        <span>Updates <b>{updates.length}</b></span>
        <small>{latestTaskActivity(updates, runs, agentLogs, observedAt)}</small>
      </div>
      <div className={styles.composer}>
        <Avatar user={currentUser} size="md" />
        <textarea
          value={updateBody}
          onChange={(e) => setUpdateBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void onPostUpdate();
            }
          }}
          rows={2}
          placeholder="Share progress, a decision, or a blocker…"
        />
        <button type="button" className="button button-primary" disabled={!updateBody.trim() || postingUpdate} onClick={onPostUpdate}>
          <Send /> {postingUpdate ? "Posting…" : "Post update"}
        </button>
      </div>
      <div className={styles.list}>
        {updates.length
          ? updates.map((update) => (
            <article className={styles.update} key={update.id}>
              <Avatar user={update.author} size="md" />
              <div>
                <header>
                  <strong>{update.author.name}{update.author.kind === "AGENT" && <em>Agent</em>}</strong>
                  <time>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(update.createdAt))}</time>
                </header>
                <p>{update.body}</p>
              </div>
            </article>
          ))
          : <p className={styles.empty}>No updates yet. Add the first progress note above.</p>}
      </div>
      <section className={styles.activity}>
        <div className="section-heading"><span>Activity log <b>{activity.length}</b></span></div>
        {activity.length
          ? (
            <div className={styles.activityList}>
              {activity.map((event) => (
                <div className={styles.activityEvent} key={event.id}>
                  <span className={styles.activityDot} />
                  <span className={styles.activityBody}>
                    <strong>{event.actorName}</strong>
                    {event.actorKind === "AGENT" && <em>Agent</em>}
                    <span>{activityLabel(event.action, event.metadata)}</span>
                    <time>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</time>
                  </span>
                </div>
              ))}
            </div>
          )
          : <p className={styles.empty}>No activity recorded yet.</p>}
      </section>
    </section>
  );
}

function activityLabel(action: string, metadata: Record<string, unknown>): string {
  switch (action) {
    case "task.created": return "created this task";
    case "task.claimed": return "claimed this task";
    case "task.auto_routed": return `auto-routed this task to agent ${String(metadata.selectedAgentId)}`;
    case "task.routing_overridden": return `overrode routing to agent ${String(metadata.selectedAgentId)}`;
    case "task.note_added": return "posted an update";
    case "task.agent_cycle_forced": return `authorized one additional agent cycle (${String(metadata.priorCount)} → limit ${String(metadata.newLimit)})`;
    case "agent_plan.proposed": return `proposed implementation plan v${String(metadata.version)}`;
    case "agent_plan.approved": return `approved implementation plan v${String(metadata.version)}`;
    case "agent_plan.rejected": return `rejected implementation plan v${String(metadata.version)}`;
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

function latestTaskActivity(updates: UpdatesPanelProps["updates"], runs: UpdatesPanelProps["runs"], logs: UpdatesPanelProps["agentLogs"], now: number): string {
  const timestamps = [
    ...updates.map((item) => Date.parse(item.createdAt)),
    ...runs.map((item) => Date.parse(item.updatedAt)),
    ...logs.map((item) => Date.parse(item.createdAt)),
  ].filter(Number.isFinite);
  if (!timestamps.length) return "No provider activity yet";
  return `Last activity ${formatAge(Math.max(0, now - Math.max(...timestamps)))} ago`;
}
