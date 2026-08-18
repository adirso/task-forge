import { useCallback, useEffect, useMemo, useState } from "react";
import type { Notification, Phase, Project, Tag, Task, TaskCreate, TaskPriority, TaskSearchResult, TaskStatus, User } from "@taskforge/contracts";
import { Bell, ChevronDown, Filter, Flag, Kanban, LayoutList, Link2, Menu, Plus, Search, Settings, Tag as TagIcon, X, Zap } from "lucide-react";
import { api, ApiError } from "./lib/api";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { BoardView } from "./components/BoardView";
import { ListView } from "./components/ListView";
import { TaskModal } from "./components/TaskModal";
import { ProjectModal } from "./components/ProjectModal";
import { NotificationPanel } from "./components/NotificationPanel";
import { SearchPalette } from "./components/SearchPalette";
import { SettingsPage } from "./components/SettingsPage";
import { PhasesPage } from "./components/PhaseManager";
import { ProjectDeleteModal } from "./components/ProjectDeleteModal";
import { ProjectMembersModal } from "./components/ProjectMembersModal";
import { ProjectHeaderActions } from "./components/ProjectHeaderActions";
import { LogoutConfirmModal } from "./components/LogoutConfirmModal";
import { AutomationManager } from "./components/AutomationManager";
import { DashboardPage } from "./components/DashboardPage";
import { boardPhaseQueryValue, resolveBoardPhase } from "./lib/boardPhase";

type DefaultView = "board" | "list";
type View = DefaultView | "phases" | "automations";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [boardPhaseId, setBoardPhaseId] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [view, setView] = useState<View>(() => localStorage.getItem("taskforge_default_view") === "list" ? "list" : "board");
  const [query, setQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [estimateMin, setEstimateMin] = useState("");
  const [estimateMax, setEstimateMax] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [textSize, setTextSize] = useState<"comfortable" | "large">(() => localStorage.getItem("taskforge_text_size") === "large" ? "large" : "comfortable");
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);

  function applyProjectMembers(updated: Project) {
    if (currentProject?.id !== updated.id) return;
    const memberIds = new Set(updated.members?.map((member) => member.id) ?? []);
    setCurrentProject(updated);
    setTasks((items) => items.map((task) => task.assigneeId && !memberIds.has(task.assigneeId) ? { ...task, assigneeId: null, assignee: null } : task));
  }

  const loadProject = useCallback(async (id: string, phaseRef?: string | null) => {
    const [{ project }, taskData, phaseData, tagData] = await Promise.all([api.project(id), api.tasks(id), api.phases(id), api.tags(id)]);
    setCurrentProject(project); setTasks(taskData.tasks); setPhases(phaseData.phases); setTags(tagData.tags); setTagFilter("");
    setBoardPhaseId(resolveBoardPhase(phaseData.phases, phaseRef)?.id ?? null);
    return { project, tasks: taskData.tasks, phases: phaseData.phases };
  }, []);

  const loadWorkspace = useCallback(async () => {
    const [{ user: me }, { projects: projectList }, { users }, notificationData] = await Promise.all([api.me(), api.projects(), api.users(), api.notifications()]);
    setUser(me); setProjects(projectList); setAllUsers(users); setNotifications(notificationData.notifications);
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("view") === "phases") setView("phases");
    else if (urlParams.get("view") === "automations") setView("automations");
    else if (urlParams.get("view") === "list") setView("list");
    else if (urlParams.get("view") === "board") setView("board");
    if (urlParams.has("settings")) {
      setShowSettings(true);
    } else if (urlParams.get("project") || urlParams.get("task")) {
      try {
        const context = await api.context({ project: urlParams.get("project") ?? undefined, task: urlParams.get("task") ?? undefined });
        const loaded = await loadProject(context.project.id, urlParams.get("phase"));
        if (context.task) setSelectedTask(loaded.tasks.find((task) => task.id === context.task?.id) ?? context.task);
      } catch {
        if (projectList[0]) await loadProject(projectList[0].id);
      }
    }
  }, [loadProject]);

  useEffect(() => {
    if (!localStorage.getItem("taskforge_token")) { setLoading(false); return; }
    loadWorkspace().catch((error) => { if (error instanceof ApiError && error.status === 401) localStorage.removeItem("taskforge_token"); }).finally(() => setLoading(false));
  }, [loadWorkspace]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setShowSearch(true);
      }
      if (event.key === "Escape") setShowSearch(false);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
  }, [textSize]);

  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    if (showSettings) {
      url.searchParams.set("settings", "account");
      url.searchParams.delete("project"); url.searchParams.delete("task"); url.searchParams.delete("phase");
    } else if (currentProject) {
      url.searchParams.delete("settings");
      url.searchParams.set("project", currentProject.key);
      url.searchParams.set("view", view);
      if (selectedTask) url.searchParams.set("task", `${currentProject.key}-${selectedTask.number}`);
      else url.searchParams.delete("task");
      const phaseQuery = view === "board" ? boardPhaseQueryValue(phases.find((phase) => phase.id === boardPhaseId) ?? null, phases.find((phase) => phase.isActive) ?? null) : null;
      if (phaseQuery) url.searchParams.set("phase", phaseQuery);
      else url.searchParams.delete("phase");
    } else {
      url.searchParams.delete("settings");
      url.searchParams.delete("project");
      url.searchParams.delete("task");
      url.searchParams.delete("phase");
      url.searchParams.delete("view");
    }
    window.history.replaceState({}, "", url);
  }, [user, showSettings, currentProject, selectedTask, view, boardPhaseId, phases]);

  async function login(email: string, password: string) {
    const result = await api.login(email, password);
    localStorage.setItem("taskforge_token", result.token); setUser(result.user); setLoading(true);
    await loadWorkspace(); setLoading(false);
  }
  function logout() { localStorage.removeItem("taskforge_token"); setUser(null); setProjects([]); setCurrentProject(null); setShowLogoutConfirm(false); }
  function flash(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const matchesQuery = !query || `${task.title} ${task.description} ${task.tags.map((tag) => tag.name).join(" ")} ${currentProject?.key}-${task.number}`.toLowerCase().includes(query.toLowerCase());
    const estimate = task.estimatePoints;
    return matchesQuery && (!assigneeFilter || task.assigneeId === assigneeFilter)
      && (!statusFilter || task.status === statusFilter) && (!priorityFilter || task.priority === priorityFilter)
      && (!tagFilter || task.tags.some((tag) => tag.id === tagFilter))
      && (!estimateMin || (estimate !== null && estimate >= Number(estimateMin)))
      && (!estimateMax || (estimate !== null && estimate <= Number(estimateMax)));
  }), [tasks, query, assigneeFilter, statusFilter, priorityFilter, tagFilter, estimateMin, estimateMax, currentProject]);

  const activePhase = phases.find((phase) => phase.isActive) ?? null;
  const selectedBoardPhase = phases.find((phase) => phase.id === boardPhaseId) ?? activePhase;
  const boardTasks = selectedBoardPhase ? visibleTasks.filter((task) => task.phaseId === selectedBoardPhase.id) : [];
  const selectedPhaseHasTasks = selectedBoardPhase ? tasks.some((task) => task.phaseId === selectedBoardPhase.id) : false;

  async function saveTask(input: TaskCreate) {
    if (!currentProject) return;
    if (selectedTask) {
      const { task } = await api.updateTask(selectedTask.id, input); setTasks((items) => items.map((item) => item.id === task.id ? task : item)); flash("Task updated");
    } else {
      const { task } = await api.createTask(currentProject.id, input); setTasks((items) => [...items, task]); flash("Task created");
    }
    const [phaseData, tagData] = await Promise.all([api.phases(currentProject.id), api.tags(currentProject.id)]); setPhases(phaseData.phases); setTags(tagData.tags);
  }
  async function moveTask(id: string, status: TaskStatus) {
    const existing = tasks.find((task) => task.id === id); if (!existing || existing.status === status) return;
    setTasks((items) => items.map((task) => task.id === id ? { ...task, status } : task));
    try { const { task } = await api.updateTask(id, { status }); setTasks((items) => items.map((item) => item.id === id ? task : item)); }
    catch { setTasks((items) => items.map((task) => task.id === id ? existing : task)); flash("Could not move task"); }
  }
  async function deleteSelected() {
    if (!selectedTask || !window.confirm(`Delete ${currentProject?.key}-${selectedTask.number} and any subtasks?`)) return;
    await api.deleteTask(selectedTask.id); setTasks((items) => items.filter((item) => item.id !== selectedTask.id && item.parentId !== selectedTask.id));
    if (currentProject) setPhases((await api.phases(currentProject.id)).phases);
    setSelectedTask(null); flash("Task deleted");
  }
  async function createProject(input: { key: string; name: string; description: string; repoUrl: string | null; color: string }) {
    const { project } = await api.createProject(input); setProjects((items) => [project, ...items]); setShowSettings(false); await loadProject(project.id); flash("Project created");
  }
  async function updateProject(input: { name: string; description: string; repoUrl: string | null; color: string }) {
    if (!currentProject) return;
    const { project } = await api.updateProject(currentProject.id, input);
    setCurrentProject((current) => current?.id === project.id ? { ...current, ...project } : current);
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, ...project } : item));
    setShowEditProject(false); flash("Project updated");
  }
  async function openNotification(notification: Notification) {
    if (!notification.readAt) {
      const { notification: updated } = await api.readNotification(notification.id);
      setNotifications((items) => items.map((item) => item.id === updated.id ? updated : item));
    }
    if (notification.projectId) { setShowSettings(false); await loadProject(notification.projectId); }
    if (notification.taskId) {
      try { const { task } = await api.task(notification.taskId); setSelectedTask(task); }
      catch { flash("The related task is no longer available"); }
    }
    setShowNotifications(false);
  }
  async function readAllNotifications() {
    await api.readAllNotifications();
    const readAt = new Date().toISOString();
    setNotifications((items) => items.map((item) => item.readAt ? item : { ...item, readAt }));
  }
  async function openSearchResult(task: TaskSearchResult) {
    await loadProject(task.projectId);
    setShowSettings(false);
    setSelectedTask(task);
    setShowSearch(false);
  }
  function changeDefaultView(nextView: DefaultView) { setView(nextView); localStorage.setItem("taskforge_default_view", nextView); }
  function changeTextSize(nextSize: "comfortable" | "large") { setTextSize(nextSize); localStorage.setItem("taskforge_text_size", nextSize); }
  async function copyProjectLink() {
    if (!currentProject) return;
    const url = new URL(window.location.href);
    url.search = ""; url.searchParams.set("project", currentProject.key); url.searchParams.set("view", view);
    const phaseQuery = view === "board" ? boardPhaseQueryValue(selectedBoardPhase, activePhase) : null;
    if (phaseQuery) url.searchParams.set("phase", phaseQuery);
    await navigator.clipboard.writeText(url.toString()); flash("Project link copied");
  }
  async function deleteCurrentProject() {
    if (!currentProject) return;
    await api.deleteProject(currentProject.id);
    const remaining = projects.filter((project) => project.id !== currentProject.id);
    setProjects(remaining); setCurrentProject(null); setTasks([]); setPhases([]); setTags([]); setSelectedTask(null); setShowDeleteProject(false);
    if (remaining[0]) await loadProject(remaining[0].id);
    else {
      const url = new URL(window.location.href); url.searchParams.delete("project"); url.searchParams.delete("task"); url.searchParams.delete("view"); window.history.replaceState({}, "", url);
    }
    flash("Project deleted");
  }
  async function reorderProjects(projectIds: string[]) {
    const previous = projects;
    const byId = new Map(projects.map((project) => [project.id, project]));
    setProjects(projectIds.map((id) => byId.get(id)).filter((project): project is Project => Boolean(project)));
    try { await api.reorderProjects(projectIds); } catch { setProjects(previous); flash("Could not save project order"); }
  }

  if (loading) return <div className="loading-screen"><span className="loading-mark" />Loading your workspace…</div>;
  if (!user) return <Login onLogin={login} />;

  const members = currentProject?.members ?? allUsers.filter((candidate) => candidate.id === user.id);
  return (
    <div className="app-shell">
      <Sidebar projects={projects} currentId={showSettings ? null : currentProject?.id ?? null} user={user} unreadCount={notifications.filter((item) => !item.readAt).length} settingsActive={showSettings} dashboardActive={!showSettings && !currentProject} onSearch={() => setShowSearch(true)} onNotifications={() => setShowNotifications((shown) => !shown)} onSettings={() => { setSelectedTask(null); setShowSettings(true); }} onSelect={(id) => { setShowSettings(false); setSelectedTask(null); loadProject(id).catch(() => flash("Could not load project")); }} onCreate={() => { setShowSettings(false); setShowProjectModal(true); }} onLogout={() => setShowLogoutConfirm(true)} onReorder={(projectIds) => reorderProjects(projectIds).catch(() => undefined)} onHome={() => { setShowSettings(false); setCurrentProject(null); setSelectedTask(null); }} />
      {showMobileNav && <button className="mobile-nav-scrim" type="button" aria-label="Close navigation menu" onClick={() => setShowMobileNav(false)} />}
      <Sidebar className={`mobile-sidebar${showMobileNav ? " mobile-open" : ""}`} onNavigate={() => setShowMobileNav(false)} projects={projects} currentId={showSettings ? null : currentProject?.id ?? null} user={user} unreadCount={notifications.filter((item) => !item.readAt).length} settingsActive={showSettings} dashboardActive={!showSettings && !currentProject} onSearch={() => setShowSearch(true)} onNotifications={() => setShowNotifications((shown) => !shown)} onSettings={() => { setSelectedTask(null); setShowSettings(true); }} onSelect={(id) => { setShowSettings(false); setSelectedTask(null); loadProject(id).catch(() => flash("Could not load project")); }} onCreate={() => { setShowSettings(false); setShowProjectModal(true); }} onLogout={() => setShowLogoutConfirm(true)} onReorder={(projectIds) => reorderProjects(projectIds).catch(() => undefined)} onHome={() => { setShowSettings(false); setCurrentProject(null); setSelectedTask(null); }} />
      <main className="workspace">
        <header className="mobile-topbar">
          <button type="button" className="mobile-topbar-menu" aria-label="Open navigation menu" onClick={() => setShowMobileNav(true)}><Menu /></button>
          <strong>TaskForge</strong>
          <div>
            <button type="button" className="mobile-topbar-icon" aria-label="Search" onClick={() => setShowSearch(true)}><Search /></button>
            <button type="button" className="mobile-topbar-icon" aria-label="Notifications" onClick={() => setShowNotifications(true)}><Bell />{notifications.some((item) => !item.readAt) && <i>{notifications.filter((item) => !item.readAt).length}</i>}</button>
          </div>
        </header>
        {showSettings ? <SettingsPage user={user} users={allUsers} defaultView={localStorage.getItem("taskforge_default_view") === "list" ? "list" : "board"} textSize={textSize} onUserUpdated={(updated) => { setUser(updated); setAllUsers((items) => items.map((item) => item.id === updated.id ? updated : item)); }} onAgentCreated={(created) => setAllUsers((items) => [...items, created])} onAgentUpdated={(updated) => { setAllUsers((items) => items.map((item) => item.id === updated.id ? updated : item)); setTasks((items) => items.map((task) => task.assigneeId === updated.id ? { ...task, assignee: updated } : task)); }} onAgentDeleted={(id) => setAllUsers((items) => items.filter((item) => item.id !== id))} onDefaultViewChange={changeDefaultView} onTextSizeChange={changeTextSize} /> : currentProject ? <>
          <header className="project-header">
            <div className="breadcrumbs"><span>Projects</span><span>/</span><strong>{currentProject.name}</strong></div>
            <div className="project-title-row">
              <div><span className="project-logo" style={{ background: currentProject.color }}>{currentProject.key.slice(0, 1)}</span><div><h1>{currentProject.name}</h1><p>{currentProject.description}</p></div></div>
              <div className="header-actions">
                <button className="mobile-settings-button" onClick={() => { setSelectedTask(null); setShowSettings(true); }} aria-label="Settings"><Settings /></button>
                <button className="mobile-search-button" onClick={() => setShowSearch(true)} aria-label="Search all tasks"><Search /></button>
                <button className="mobile-notification-button" onClick={() => setShowNotifications(true)} aria-label="Notifications"><Bell />{notifications.some((item) => !item.readAt) && <i>{notifications.filter((item) => !item.readAt).length}</i>}</button>
                <ProjectHeaderActions
                  members={members}
                  canManageProject={user.role === "ADMIN" || currentProject.ownerId === user.id}
                  onOpenMembers={() => setShowMembersModal(true)}
                  onCopyLink={() => { copyProjectLink().catch(() => flash("Could not copy link")); }}
                  onEdit={() => setShowEditProject(true)}
                  onDelete={() => setShowDeleteProject(true)}
                  onCreateTask={() => setNewTaskStatus("TODO")}
                />
              </div>
            </div>
            <div className="project-tabs"><button className={view === "board" ? "active" : ""} onClick={() => changeDefaultView("board")}><Kanban /> Board</button><button className={view === "list" ? "active" : ""} onClick={() => changeDefaultView("list")}><LayoutList /> List</button><button className={view === "phases" ? "active" : ""} onClick={() => setView("phases")}><Flag /> Phases</button><button className={view === "automations" ? "active" : ""} onClick={() => setView("automations")}><Zap /> Automations</button>{currentProject.repoUrl?.trim() && <a href={currentProject.repoUrl} target="_blank" rel="noreferrer"><Link2 /> Repository</a>}</div>
          </header>
          {view !== "phases" && view !== "automations" && <section className="content-toolbar">
            <div className="search-field"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…" />{query && <button onClick={() => setQuery("")}><X /></button>}</div>
            <div className="toolbar-spacer" />
            <div className="select-wrap"><select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}><option value="">All statuses</option><option value="BACKLOG">Backlog</option><option value="TODO">To do</option><option value="IN_PROGRESS">In progress</option><option value="IN_REVIEW">In review</option><option value="DONE">Done</option></select><ChevronDown /></div>
            <div className="select-wrap"><Filter /><select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}><option value="">All assignees</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><ChevronDown /></div>
            <div className="select-wrap"><select aria-label="Filter by priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | "")}><option value="">All priorities</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select><ChevronDown /></div>
            <div className="select-wrap"><TagIcon /><select aria-label="Filter by tag" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}><option value="">All tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><ChevronDown /></div>
            <div className="estimate-filter" title="Estimated points range"><span>Points</span><input type="number" min="0" max="100" value={estimateMin} onChange={(e) => setEstimateMin(e.target.value)} placeholder="Min" aria-label="Minimum estimated points" /><i>–</i><input type="number" min="0" max="100" value={estimateMax} onChange={(e) => setEstimateMax(e.target.value)} placeholder="Max" aria-label="Maximum estimated points" /></div>
            {(statusFilter || assigneeFilter || priorityFilter || tagFilter || estimateMin || estimateMax) && <button className="clear-filters" onClick={() => { setStatusFilter(""); setAssigneeFilter(""); setPriorityFilter(""); setTagFilter(""); setEstimateMin(""); setEstimateMax(""); }}>Clear</button>}
            <span className="task-total">{view === "board" ? boardTasks.length : visibleTasks.length} {view === "board" ? boardTasks.length === 1 ? "task" : "tasks" : visibleTasks.length === 1 ? "task" : "tasks"}</span>
          </section>}
          {view === "automations" && <AutomationManager project={currentProject} users={allUsers} phases={phases} />}
          <section className={`content-area${view === "automations" ? " automations-hidden" : ""}`}>
            {view === "phases" ? <PhasesPage project={currentProject} phases={phases} onChange={(updated) => { setPhases(updated); setBoardPhaseId((selectedId) => updated.some((phase) => phase.id === selectedId) ? selectedId : resolveBoardPhase(updated)?.id ?? null); setTasks((items) => items.map((task) => task.phaseId && !updated.some((phase) => phase.id === task.phaseId) ? { ...task, phaseId: null } : task)); }} /> : view === "board" ? <>{selectedBoardPhase ? <><div className={`active-phase-banner${selectedBoardPhase.isActive ? "" : " viewing-phase"}`}><span className="phase-number-badge">{selectedBoardPhase.number}</span><div className="phase-banner-copy"><span>{selectedBoardPhase.isActive ? "Active phase" : "Viewing phase"}</span><strong>Phase {selectedBoardPhase.number}</strong><p>{selectedBoardPhase.goal}</p></div><label className="board-phase-selector"><span>Board phase</span><div><select aria-label="Board phase" value={selectedBoardPhase.id} onChange={(event) => setBoardPhaseId(event.target.value)}>{[...phases].sort((a, b) => a.number - b.number).map((phase) => <option key={phase.id} value={phase.id}>Phase {phase.number}{phase.isActive ? " · Active" : ""}</option>)}</select><ChevronDown /></div></label><small>{boardTasks.length} {boardTasks.length === 1 ? "task" : "tasks"}</small><button className="button button-secondary" onClick={() => setView("phases")}>Manage phases</button></div>{selectedPhaseHasTasks ? <BoardView tasks={boardTasks} project={currentProject} onOpen={setSelectedTask} onCreate={setNewTaskStatus} onMove={moveTask} /> : <div className="empty-board-phase"><Flag /><strong>No tasks in Phase {selectedBoardPhase.number}</strong><span>This phase is ready for its first task.</span><button className="button button-primary" onClick={() => setNewTaskStatus("TODO")}><Plus /> Create task</button></div>}</> : <div className="no-active-phase"><Flag /><div><strong>No active phase</strong><span>Choose an active phase to populate the board.</span></div><button className="button button-primary" onClick={() => setView("phases")}>Manage phases</button></div>}</> : <ListView tasks={visibleTasks} phases={phases} project={currentProject} onOpen={setSelectedTask} />}
          </section>
        </> : <DashboardPage currentUser={user} />}
      </main>
      {(selectedTask || newTaskStatus) && currentProject && <TaskModal task={selectedTask} initialStatus={newTaskStatus ?? selectedTask?.status ?? "TODO"} defaultPhaseId={(view === "board" ? selectedBoardPhase : activePhase)?.id ?? null} project={currentProject} currentUser={user} members={members} phases={phases} availableTags={tags} tasks={tasks} onClose={() => { setSelectedTask(null); setNewTaskStatus(null); }} onSave={saveTask} onDelete={selectedTask ? deleteSelected : null} />}
      {showProjectModal && <ProjectModal projects={projects} onClose={() => setShowProjectModal(false)} onSave={createProject} />}
      {showEditProject && currentProject && <ProjectModal project={currentProject} onClose={() => setShowEditProject(false)} onSave={async ({ name, description, repoUrl, color }) => updateProject({ name, description, repoUrl, color })} />}
      {showDeleteProject && currentProject && <ProjectDeleteModal project={currentProject} onClose={() => setShowDeleteProject(false)} onConfirm={deleteCurrentProject} />}
      {showMembersModal && currentProject && <ProjectMembersModal project={currentProject} users={allUsers} currentUser={user} onClose={() => setShowMembersModal(false)} onChanged={applyProjectMembers} />}
      {showLogoutConfirm && <LogoutConfirmModal user={user} onClose={() => setShowLogoutConfirm(false)} onConfirm={logout} />}
      {showNotifications && <><button className="notification-scrim" aria-label="Close notifications" onClick={() => setShowNotifications(false)} /><NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} onOpen={(notification) => openNotification(notification).catch(() => flash("Could not open notification"))} onReadAll={() => readAllNotifications().catch(() => flash("Could not update notifications"))} /></>}
      {showSearch && <SearchPalette onClose={() => setShowSearch(false)} onOpen={(task) => openSearchResult(task).catch(() => flash("Could not open task"))} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
