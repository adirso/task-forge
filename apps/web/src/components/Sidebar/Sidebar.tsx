import { Bell, ChevronDown, LayoutDashboard, Layers3, Plus, Search, Settings } from "lucide-react";
import { Avatar } from "../Avatar";
import type { SidebarProps } from "./types";
import styles from "./Sidebar.module.css";

export function Sidebar({ projects, currentId, user, unreadCount, settingsActive, dashboardActive, onSearch, onNotifications, onSettings, onSelect, onCreate, onLogout, onReorder, onHome, className, onNavigate }: SidebarProps) {
  function moveProject(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const next = [...projects]; const sourceIndex = next.findIndex((project) => project.id === sourceId); const targetIndex = next.findIndex((project) => project.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(sourceIndex, 1); next.splice(targetIndex, 0, moved!); onReorder(next.map((project) => project.id));
  }
  return (
    <aside className={`sidebar ${styles.root}${className ? ` ${className}` : ""}`} aria-label={className?.includes("mobile-sidebar") ? "Mobile navigation" : undefined}>
      <div className="brand-lockup"><span className="brand-mark"><Layers3 /></span>TaskForge</div>
      <nav className="main-nav">
        <button className={dashboardActive ? "active" : ""} onClick={() => { onHome(); onNavigate?.(); }}><LayoutDashboard /><span>Home</span></button>
        <button onClick={() => { onSearch(); onNavigate?.(); }}><Search /><span>Search</span><kbd>⌘ K</kbd></button>
        <button onClick={() => { onNotifications(); onNavigate?.(); }} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}><Bell /><span>Notifications</span>{unreadCount > 0 && <i>{unreadCount > 99 ? "99+" : unreadCount}</i>}</button>
      </nav>
      <div className="nav-section-title"><span>Projects</span><button onClick={() => { onCreate(); onNavigate?.(); }} aria-label="Create project"><Plus /></button></div>
      <nav className="project-nav">
        {projects.map((project) => (
          <button key={project.id} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/project-id", project.id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); moveProject(event.dataTransfer.getData("text/project-id"), project.id); }} aria-label={`${project.name}. Drag to reorder`} className={currentId === project.id ? "active" : ""} onClick={() => { onSelect(project.id); onNavigate?.(); }}>
            <span className="project-glyph" style={{ background: project.color }}>{project.key.slice(0, 1)}</span>
            <span title={project.name}>{project.name}</span><small>{project.taskCount ?? 0}</small>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className={settingsActive ? "active" : ""} onClick={() => { onSettings(); onNavigate?.(); }}><Settings /><span>Settings</span></button>
        <button className="profile-button" onClick={() => { onLogout(); onNavigate?.(); }} aria-label="Log out"><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.email}</small></span><ChevronDown /></button>
      </div>
    </aside>
  );
}
