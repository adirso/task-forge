import { useEffect, useState } from "react";
import type { ActivityEvent } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { Avatar } from "../Avatar";

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actionLabel(event: ActivityEvent): string {
  switch (event.action) {
    case "task.created": return "created a task";
    case "task.updated": return "updated a task";
    case "task.deleted": return "deleted a task";
    case "task.status_changed": return `moved to ${(event.meta as { to?: string })?.to ?? "a new status"}`;
    case "task.assigned": return "assigned a task";
    case "task.update_added": return "posted an update";
    case "task.attachment_added": return "added an attachment";
    case "task.attachment_deleted": return "removed an attachment";
    case "task.claimed": return "claimed a task";
    default: return event.action.replace(/\./g, " ");
  }
}

export function ActivityWidget() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.activityFeed(20)
      .then((res) => setEvents(res.activity))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  if (error) return <div className="widget-error">{error}</div>;
  if (!events) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (events.length === 0) return <div className="widget-empty">No recent activity.</div>;

  return (
    <div className="widget-activity">
      {events.map((event) => (
        <div key={event.id} className="wa-row">
          <Avatar user={{ name: event.actorName ?? "?", avatarUrl: null, kind: "HUMAN" }} size="sm" />
          <div className="wa-body">
            <span className="wa-actor">{event.actorName ?? "Someone"}</span>
            {" "}
            <span className="wa-action">{actionLabel(event)}</span>
            {event.taskTitle && <span className="wa-task">: {event.taskTitle}</span>}
          </div>
          <span className="wa-time">{formatRelative(event.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
