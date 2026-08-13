import { useEffect, useState } from "react";
import type { AgentOpsEntry } from "@taskforge/contracts";
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, ExternalLink, RefreshCw, Webhook } from "lucide-react";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";

export function AgentOpsPage({ onOpenAgent }: { onOpenAgent?: (agentId: string) => void }) {
  const [agents, setAgents] = useState<AgentOpsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const { agents: data } = await api.agentOps();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agent ops data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const totalStuck = agents.reduce((sum, a) => sum + a.stuckTaskCount, 0);
  const totalOpen = agents.reduce((sum, a) => sum + a.openTaskCount, 0);

  if (loading) return <div className="agent-ops-loading"><Bot /><span>Loading agent fleet…</span></div>;
  if (error) return <div className="form-error">{error}</div>;

  return (
    <div className="agent-ops">
      <div className="agent-ops-header">
        <div className="agent-ops-summary">
          <span><strong>{agents.length}</strong> agents</span>
          <span><strong>{totalOpen}</strong> open tasks</span>
          {totalStuck > 0 && <span className="stuck-summary"><AlertTriangle /><strong>{totalStuck}</strong> stuck</span>}
        </div>
        <button type="button" className="button button-secondary agent-ops-refresh" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spinning" : ""} /> Refresh
        </button>
      </div>

      {agents.length === 0 && (
        <div className="agent-ops-empty"><Bot /><span>No agents have been created yet.</span></div>
      )}

      <div className="agent-ops-grid">
        {agents.map((agent) => (
          <article key={agent.id} className={`agent-ops-card${agent.stuckTaskCount > 0 ? " has-stuck" : ""}`}>
            <header>
              <Avatar user={agent} size="md" />
              <div className="agent-ops-card-title">
                <strong>{agent.name}</strong>
                <small>{agent.email}</small>
              </div>
              {agent.stuckTaskCount > 0
                ? <span className="ops-badge ops-badge-stuck"><AlertTriangle /> {agent.stuckTaskCount} stuck</span>
                : agent.openTaskCount > 0
                  ? <span className="ops-badge ops-badge-active"><Activity /> {agent.openTaskCount} active</span>
                  : <span className="ops-badge ops-badge-idle"><CheckCircle2 /> Idle</span>}
            </header>

            <div className="agent-ops-meta">
              <span>
                <Clock />
                {agent.lastActiveAt
                  ? <>Last seen {formatRelative(agent.lastActiveAt)}</>
                  : "Never used token"}
              </span>
              {agent.webhookUrl && (
                <span title={agent.webhookUrl}><Webhook /> Webhook configured</span>
              )}
            </div>

            {agent.inProgressTasks.length > 0 && (
              <div className="agent-ops-tasks">
                {agent.inProgressTasks.slice(0, 5).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`agent-ops-task${task.isStuck ? " is-stuck" : ""}`}
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.search = "";
                      url.searchParams.set("project", task.projectKey);
                      url.searchParams.set("task", `${task.projectKey}-${task.number}`);
                      window.location.href = url.toString();
                    }}
                  >
                    <span className="ops-task-key">{task.projectKey}-{task.number}</span>
                    <span className="ops-task-title">{task.title}</span>
                    {task.isStuck && <AlertTriangle title="Stuck — not updated in 4+ hours" />}
                  </button>
                ))}
                {agent.inProgressTasks.length > 5 && (
                  <div className="agent-ops-more">+{agent.inProgressTasks.length - 5} more</div>
                )}
              </div>
            )}

            {onOpenAgent && (
              <button type="button" className="agent-ops-link" onClick={() => onOpenAgent(agent.id)}>
                <ExternalLink /> View in settings
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
