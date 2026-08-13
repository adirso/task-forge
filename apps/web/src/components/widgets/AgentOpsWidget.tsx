import { useEffect, useState } from "react";
import type { AgentOpsEntry } from "@taskforge/contracts";
import { AlertTriangle, Bot, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import type { User } from "@taskforge/contracts";
import { Avatar } from "../Avatar";

function openTask(projectKey: string, number: number) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("project", projectKey);
  url.searchParams.set("task", `${projectKey}-${number}`);
  window.location.href = url.toString();
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AgentOpsWidget({ currentUser }: { currentUser: User }) {
  const [agents, setAgents] = useState<AgentOpsEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.agentOps().then(setAgents).catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (currentUser.role !== "ADMIN") {
    return (
      <div className="widget-empty">
        <ShieldCheck style={{ width: 20, opacity: 0.5 }} />
        Admin access required.
      </div>
    );
  }

  if (error) return <div className="widget-error">{error}</div>;
  if (!agents) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (agents.length === 0) return <div className="widget-empty"><Bot style={{ width: 20, opacity: 0.4 }} /> No agents yet.</div>;

  return (
    <div className="widget-agent-ops">
      {agents.map((agent) => (
        <div key={agent.id} className={`wao-row${agent.stuckTaskCount > 0 ? " wao-stuck" : ""}`}>
          <Avatar user={agent} size="sm" />
          <div className="wao-info">
            <span className="wao-name">{agent.name}</span>
            <span className="wao-meta">
              {agent.lastActiveAt ? formatRelative(agent.lastActiveAt) : "Never active"}
              {" · "}
              {agent.openTaskCount} open
              {agent.stuckTaskCount > 0 && <span className="wao-stuck-badge"><AlertTriangle /> {agent.stuckTaskCount} stuck</span>}
            </span>
          </div>
          {agent.inProgressTasks.slice(0, 2).map((task) => (
            <button
              key={task.id}
              type="button"
              className={`wao-task${task.isStuck ? " wao-task-stuck" : ""}`}
              onClick={() => openTask(task.projectKey, task.number)}
            >
              {task.projectKey}-{task.number}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
