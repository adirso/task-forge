import type { AgentOpsEntry } from "@taskforge/contracts";
import { AlertTriangle, Bot, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { openTask } from "../../lib/dashboardNav";
import { useWidgetQuery } from "../../lib/widgetQuery";
import type { User } from "@taskforge/contracts";
import { Avatar } from "../Avatar";
import { WidgetEmpty, WidgetError, WidgetLoading } from "../WidgetShell";

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
  const isAdmin = currentUser.role === "ADMIN";
  const { data: agents, error, loading, reload } = useWidgetQuery<AgentOpsEntry[]>(
    () => api.agentOps().then((res) => res.agents),
    { enabled: isAdmin },
  );

  if (!isAdmin) {
    return (
      <WidgetEmpty>
        <ShieldCheck style={{ width: 20, opacity: 0.5 }} />
        Admin access required.
      </WidgetEmpty>
    );
  }

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !agents) return <WidgetLoading lines={2} />;
  if (agents.length === 0) return <WidgetEmpty><Bot style={{ width: 20, opacity: 0.4 }} /> No agents yet.</WidgetEmpty>;

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
