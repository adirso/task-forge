import type { ActivityEvent } from "@taskforge/contracts";
import { api } from "../../lib/api";
import { activityHref, openHref } from "../../lib/dashboardNav";
import { useWidgetQuery } from "../../lib/widgetQuery";
import { Avatar } from "../Avatar";
import { WidgetError } from "../WidgetShell";

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
    case "task.status_changed": return `moved to ${(event.metadata.to as string | undefined) ?? "a new status"}`;
    case "task.assigned": return "assigned a task";
    case "task.update_added": return "posted an update";
    case "task.attachment_added": return "added an attachment";
    case "task.attachment_deleted": return "removed an attachment";
    case "task.claimed": return "claimed a task";
    default: return event.action.replace(/\./g, " ");
  }
}

export function ActivityWidget() {
  const { data: events, error, loading, reload } = useWidgetQuery<ActivityEvent[]>(() => api.activityFeed(20).then((res) => res.activity));

  if (error) return <WidgetError message={error} onRetry={reload} />;
  if (loading || !events) return <div className="widget-loading"><span className="widget-skeleton" /><span className="widget-skeleton" /><span className="widget-skeleton" /></div>;
  if (events.length === 0) return <div className="widget-empty">No recent activity.</div>;

  return (
    <div className="widget-activity">
      {events.map((event) => {
        const href = activityHref(window.location.href, event);
        const content = (
          <>
            <Avatar
              user={{
                id: event.actorId,
                name: event.actorName || "Someone",
                email: null,
                kind: event.actorKind,
                role: "MEMBER",
                avatarUrl: event.actorAvatarUrl,
                createdAt: event.createdAt,
              }}
              size="sm"
            />
            <div className="wa-body">
              <span className="wa-actor">{event.actorName || "Someone"}</span>
              {" "}
              <span className="wa-action">{actionLabel(event)}</span>
              {typeof event.metadata.title === "string" && <span className="wa-task">: {event.metadata.title}</span>}
            </div>
            <span className="wa-time">{formatRelative(event.createdAt)}</span>
          </>
        );
        return href ? (
          <button key={event.id} type="button" className="wa-row wa-row-link" onClick={() => openHref(href)}>
            {content}
          </button>
        ) : (
          <div key={event.id} className="wa-row">{content}</div>
        );
      })}
    </div>
  );
}
