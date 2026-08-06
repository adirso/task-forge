import type { Notification } from "@taskforge/contracts";
import { Bell, CheckCheck, GitPullRequestArrow, UserRoundCheck, X } from "lucide-react";

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationIcon({ type }: { type: string }) {
  if (type === "REVIEW_REQUESTED") return <GitPullRequestArrow />;
  if (type === "TASK_ASSIGNED") return <UserRoundCheck />;
  return <Bell />;
}

export function NotificationPanel({ notifications, onClose, onOpen, onReadAll }: {
  notifications: Notification[]; onClose: () => void; onOpen: (notification: Notification) => void; onReadAll: () => void;
}) {
  const unread = notifications.filter((item) => !item.readAt).length;
  return (
    <aside className="notification-panel" aria-label="Notifications">
      <header><div><h2>Notifications</h2><span>{unread ? `${unread} unread` : "You're all caught up"}</span></div><button className="icon-button" onClick={onClose} aria-label="Close notifications"><X /></button></header>
      {unread > 0 && <button className="read-all" onClick={onReadAll}><CheckCheck /> Mark all as read</button>}
      <div className="notification-list">
        {notifications.length ? notifications.map((notification) => (
          <button key={notification.id} className={`notification-item ${notification.readAt ? "is-read" : ""}`} onClick={() => onOpen(notification)}>
            <span className="notification-icon"><NotificationIcon type={notification.type} /></span>
            <span className="notification-copy"><span><strong>{notification.title}</strong><small>{relativeTime(notification.createdAt)}</small></span><p>{notification.message}</p>{notification.projectKey && <em>{notification.projectKey}{notification.taskNumber ? `-${notification.taskNumber}` : ""} · {notification.projectName}</em>}</span>
            {!notification.readAt && <i className="unread-dot" />}
          </button>
        )) : <div className="notification-empty"><Bell /><strong>No notifications yet</strong><span>Updates about assignments and reviews will appear here.</span></div>}
      </div>
    </aside>
  );
}
