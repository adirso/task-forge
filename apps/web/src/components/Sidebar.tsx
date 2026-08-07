import type { Project, User } from "@taskforge/contracts";
import { Bell, ChevronDown, Layers3, Plus, Search, Settings } from "lucide-react";
import { Avatar } from "./Avatar";

export function Sidebar({ projects, currentId, user, unreadCount, settingsActive, onSearch, onNotifications, onSettings, onSelect, onCreate, onLogout, onReorder }: {
  projects: Project[]; currentId: string | null; user: User; unreadCount: number; settingsActive: boolean; onSearch: () => void; onNotifications: () => void; onSettings: () => void; onSelect: (id: string) => void; onCreate: () => void; onLogout: () => void; onReorder: (projectIds: string[]) => void;
}) {
  function moveProject(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const next = [...projects]; const sourceIndex = next.findIndex((project) => project.id === sourceId); const targetIndex = next.findIndex((project) => project.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1); next.splice(targetIndex, 0, moved!); onReorder(next.map((project) => project.id));
  }
  return (
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-mark"><Layers3 /></span>TaskForge</div>
      <nav className="main-nav">
        <button onClick={onSearch}><Search /><span>Search</span><kbd>⌘ K</kbd></button>
        <button onClick={onNotifications} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}><Bell /><span>Notifications</span>{unreadCount > 0 && <i>{unreadCount > 99 ? "99+" : unreadCount}</i>}</button>
      </nav>
      <div className="nav-section-title"><span>Projects</span><button onClick={onCreate} aria-label="Create project"><Plus /></button></div>
      <nav className="project-nav">
        {projects.map((project) => (
          <button key={project.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/project-id", project.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveProject(event.dataTransfer.getData("text/project-id"), project.id); }} aria-label={`${project.name}. Drag to reorder`} className={currentId === project.id ? "active" : ""} onClick={() => onSelect(project.id)}>
            <span className="project-glyph" style={{ background: project.color }}>{project.key.slice(0, 1)}</span>
            <span>{project.name}</span><small>{project.taskCount ?? 0}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className={settingsActive ? "active" : ""} onClick={onSettings}><Settings /><span>Settings</span></button>
        <button className="profile-button" onClick={onLogout} aria-label="Log out"><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.email}</small></span><ChevronDown /></button>
      </div>
    </aside>
  );
}
