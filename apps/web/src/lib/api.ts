import { DEFAULT_AGENT_WORKFLOW, TASK_STATUSES, type ActivityEvent, type AgentOpsEntry, type ApiTokenMetadata, type Attachment, type AuthResponse, type Automation, type AutomationCreate, type AutomationUpdate, type DashboardSummary, type DeliveryMonitorHealth, type Notification, type PageInfo, type Phase, type Project, type Tag, type Task, type TaskCreate, type TaskNote, type TaskSearchResult, type TaskUpdate, type User, type WebhookDelivery, type WebhookDeliveryStatus } from "@taskforge/contracts";

export interface AgentRun {
  id: string; taskId: string; projectId: string; requestedById: string; kind: "IMPLEMENTATION" | "REVIEW" | "RE_REVIEW" | "FIX";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; attemptCount: number; maxAttempts: number;
  leaseOwner: string | null; leaseExpiresAt: string | null; heartbeatAt: string | null; timeoutAt: string | null; lastError: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
}
export interface AgentLog { id: string; taskId: string; runId: string | null; provider: string; stream: "stdout" | "stderr" | "system" | "callback"; category: "output" | "progress" | "tool" | "callback" | "lifecycle"; sequence: number; eventId: string | null; content: string; createdAt: string; }

// In development, Vite proxies /api to the backend. Keeping the browser on one
// origin avoids localhost/127.0.0.1 CORS differences. Deployments can still set
// VITE_API_URL when the API lives on a separate origin.
const API_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

type Options = Omit<RequestInit, "body"> & { body?: unknown };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const MOCK_NOW = new Date().toISOString();
const MOCK_USER: User = {
  id: "u_admin",
  email: "demo@taskforge.local",
  name: "Demo Admin",
  kind: "HUMAN",
  role: "ADMIN",
  avatarUrl: null,
  createdAt: MOCK_NOW,
};
const MOCK_MEMBER: User = {
  id: "u_member",
  email: "alex@demo.local",
  name: "Alex Member",
  kind: "HUMAN",
  role: "MEMBER",
  avatarUrl: null,
  createdAt: MOCK_NOW,
};
const MOCK_AGENT: User = {
  id: "u_agent",
  email: "agent@demo.local",
  name: "Sprint Agent",
  kind: "AGENT",
  role: "MEMBER",
  avatarUrl: null,
  createdAt: MOCK_NOW,
};
let mockProjects: Project[] = [{
  id: "p_mobile",
  key: "MOB",
  name: "Mobile Refresh",
  description: "Fictional project for product screenshots.",
  repoUrl: "https://github.com/example/mobile-refresh",
  localRepoPath: null,
  color: "#6554c0",
  sortOrder: 0,
  availableStatuses: [...TASK_STATUSES],
  hiddenEmptyStatuses: [...TASK_STATUSES],
  defaultStatus: "TODO",
  agentWorkflow: { ...DEFAULT_AGENT_WORKFLOW },
  mergeTarget: "phase",
  ownerId: MOCK_USER.id,
  createdAt: MOCK_NOW,
  updatedAt: MOCK_NOW,
  taskCount: 8,
  members: [
    { ...MOCK_USER, projectRole: "OWNER" },
    { ...MOCK_MEMBER, projectRole: "MEMBER" },
    { ...MOCK_AGENT, projectRole: "MEMBER" },
  ],
}];
const mockPhases: Phase[] = [
  { id: "ph1", projectId: "p_mobile", number: 1, goal: "Build responsive foundation", isActive: false, branchName: "phase/mob-1", createdAt: MOCK_NOW, updatedAt: MOCK_NOW, taskCount: 5 },
  { id: "ph2", projectId: "p_mobile", number: 2, goal: "Ship polish and QA", isActive: true, branchName: "phase/mob-2", createdAt: MOCK_NOW, updatedAt: MOCK_NOW, taskCount: 3 },
];
const mockTags: Tag[] = [
  { id: "tag-ui", projectId: "p_mobile", name: "ui", createdAt: MOCK_NOW, taskCount: 4 },
  { id: "tag-mobile", projectId: "p_mobile", name: "mobile", createdAt: MOCK_NOW, taskCount: 5 },
];
let mockAutomations: Automation[] = [{
  id: "automation-demo-1", projectId: "p_mobile", name: "Route review tasks", enabled: true, trigger: "TASK_UPDATED", actorType: "ANY", actorId: null, service: null,
  conditions: [{ field: "status", operator: "changed_to", value: "READY_FOR_REVIEW", fromValue: null }],
  actions: [{ field: "assigneeId", valueType: "user", value: MOCK_USER.id }], createdAt: MOCK_NOW, updatedAt: MOCK_NOW,
}];
let mockTasks: Task[] = [
  makeMockTask(1, "Design mobile top bar", "IN_PROGRESS", "HIGH", "FEATURE", "ph1", MOCK_MEMBER, ["tag-ui", "tag-mobile"]),
  makeMockTask(2, "Add slide-out navigation drawer", "TODO", "HIGH", "FEATURE", "ph1", MOCK_AGENT, ["tag-mobile"]),
  makeMockTask(3, "Collapse filters on phones", "IN_REVIEW", "MEDIUM", "UPDATE", "ph1", MOCK_USER, ["tag-ui"]),
  makeMockTask(4, "Tune mobile header spacing", "APPROVED", "LOW", "UPDATE", "ph1", MOCK_MEMBER, ["tag-ui"]),
  makeMockTask(5, "Write dashboard docs examples", "DONE", "MEDIUM", "DOCS", "ph2", null, []),
  makeMockTask(6, "Add responsive empty states", "DONE", "MEDIUM", "FEATURE", "ph2", MOCK_MEMBER, ["tag-ui"]),
  makeMockTask(7, "Verify mobile keyboard flow", "DONE", "LOW", "UPDATE", "ph2", MOCK_AGENT, ["tag-mobile"]),
  makeMockTask(8, "Archive obsolete mobile mock", "CANCELLED", "LOW", "CHORE", "ph1", null, []),
];
const mockNotifications: Notification[] = [
  { id: "n1", userId: MOCK_USER.id, projectId: "p_mobile", taskId: "t3", type: "TASK_UPDATED", title: "Task moved to review", message: "Collapse filters on phones is ready for review.", readAt: null, createdAt: MOCK_NOW, projectName: "Mobile Refresh", projectKey: "MOB", taskNumber: 3 },
];
const mockRuns: Record<string, AgentRun[]> = {
  t1: [{ id: "run-demo-1", taskId: "t1", projectId: "p_mobile", requestedById: MOCK_USER.id, kind: "IMPLEMENTATION", status: "RUNNING", attemptCount: 1, maxAttempts: 3, leaseOwner: "smithy-demo", leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(), heartbeatAt: MOCK_NOW, timeoutAt: new Date(Date.now() + 900_000).toISOString(), lastError: null, createdAt: MOCK_NOW, updatedAt: MOCK_NOW, completedAt: null }],
};
const mockAgentLogs: Record<string, AgentLog[]> = {
  t1: [{ id: "log-demo-1", taskId: "t1", runId: "run-demo-1", provider: "codex", stream: "stdout", category: "progress", sequence: 1, eventId: "demo-event-1", content: "Implementation started on agent/mob-1", createdAt: MOCK_NOW }],
};

function mockPhaseData() {
  return mockPhases.map((phase) => {
    const phaseTasks = mockTasks.filter((task) => task.phaseId === phase.id);
    return { ...phase, taskCount: phaseTasks.length, completedTaskCount: phaseTasks.filter((task) => task.status === "DONE").length, cancelledTaskCount: phaseTasks.filter((task) => task.status === "CANCELLED").length, nonDoneTaskCount: phaseTasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).length };
  });
}

function makeMockTask(
  number: number,
  title: string,
  status: Task["status"],
  priority: Task["priority"],
  type: Task["type"],
  phaseId: string | null,
  assignee: User | null,
  tagIds: string[],
): Task {
  const pullRequest = number === 3 ? { url: "https://github.com/example/mobile-refresh/pull/3", title: "Collapse filters on phones", state: "OPEN" as const } : number === 4 ? { url: "https://github.com/example/mobile-refresh/pull/4", title: "Tune mobile header spacing", state: "OPEN" as const } : number === 6 ? { url: "https://github.com/example/mobile-refresh/pull/6", title: "Add responsive empty states", state: "MERGED" as const } : number === 8 ? { url: "https://github.com/example/mobile-refresh/pull/8", title: "Archive obsolete mobile mock", state: "CLOSED" as const } : null;
  return {
    id: `t${number}`,
    projectId: "p_mobile",
    number,
    title,
    description: "Demo task content for screenshots.",
    definitionOfDone: "Looks good in screenshots.",
    status,
    priority,
    type,
    assigneeId: assignee?.id ?? null,
    creatorId: MOCK_USER.id,
    parentId: null,
    branch: number <= 4 ? `agent/mob-${number}` : null,
    dueDate: null,
    estimatePoints: number % 3 === 0 ? 2 : 3,
    phaseId,
    pullRequestUrl: pullRequest?.url ?? null,
    pullRequestTitle: pullRequest?.title ?? null,
    pullRequestState: pullRequest?.state ?? null,
    statusDurations: status === "BACKLOG" || status === "TODO" ? {} : { [status]: status === "DONE" || status === "CANCELLED" ? 0 : number * 420 },
    position: number,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
    assignee,
    phase: phaseId ? (mockPhases.find((phase) => phase.id === phaseId) ?? null) : null,
    creator: MOCK_USER,
    subtasks: [],
    tags: mockTags.filter((tag) => tagIds.includes(tag.id)),
    dependencies: [],
    attachments: [],
  };
}

function mockDashboardSummary(): DashboardSummary {
  const project = mockProjects[0]!;
  const byStatus = (status: Task["status"]) => mockTasks.filter((task) => task.status === status);
  return {
    projects: [{
      id: project.id,
      name: project.name,
      key: project.key,
      color: project.color,
      counts: {
        BACKLOG: byStatus("BACKLOG").length,
        REFINING: byStatus("REFINING").length,
        TODO: byStatus("TODO").length,
        IN_PROGRESS: byStatus("IN_PROGRESS").length,
        READY_FOR_REVIEW: byStatus("READY_FOR_REVIEW").length,
        IN_REVIEW: byStatus("IN_REVIEW").length,
        DONE: byStatus("DONE").length,
        CANCELLED: byStatus("CANCELLED").length,
        APPROVED: byStatus("APPROVED").length,
        RE_REVIEW: byStatus("RE_REVIEW").length,
        FIX_NEEDED: byStatus("FIX_NEEDED").length,
        FIX_IN_PROGRESS: byStatus("FIX_IN_PROGRESS").length,
        PENDING_DECISION: byStatus("PENDING_DECISION").length,
        FAILED: byStatus("FAILED").length,
        total: mockTasks.length,
      },
      nonDoneTaskCount: mockTasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).length,
      cancelledTaskCount: byStatus("CANCELLED").length,
      nonDonePhaseCount: mockPhases.filter((phase) => mockTasks.some((task) => task.phaseId === phase.id && !["DONE", "CANCELLED"].includes(task.status))).length,
    }],
    myTasks: mockTasks.filter((task) => task.assigneeId === MOCK_USER.id).map(toSummaryTask),
    stuckTasks: mockTasks.filter((task) => task.status === "IN_PROGRESS").map(toSummaryTask),
  };
}

function toSummaryTask(task: Task): DashboardSummary["myTasks"][number] {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    projectId: task.projectId,
    projectKey: "MOB",
    projectName: "Mobile Refresh",
    status: task.status,
    assigneeName: task.assignee?.name ?? null,
    updatedAt: task.updatedAt,
  };
}

async function mockRequest<T>(path: string, options: Options = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const url = new URL(`http://mock${path.startsWith("/") ? path : `/${path}`}`);
  const pathname = url.pathname;

  if (pathname === "/auth/login" && method === "POST") return { token: "mock-token", user: MOCK_USER } as T;
  if (pathname === "/auth/me" && method === "GET") return { user: MOCK_USER } as T;
  if (pathname === "/projects" && method === "GET") return { projects: mockProjects } as T;
  if (pathname === "/projects/order" && method === "PATCH") return undefined as T;
  if (pathname === "/users" && method === "GET") return { users: [MOCK_USER, MOCK_MEMBER, MOCK_AGENT] } as T;
  if (pathname === "/notifications" && method === "GET") return { notifications: mockNotifications, unreadCount: mockNotifications.filter((n) => !n.readAt).length } as T;
  if (pathname === "/notifications/read-all" && method === "POST") return { updated: mockNotifications.length } as T;
  if (/^\/notifications\/[^/]+\/read$/.test(pathname) && method === "PATCH") return { notification: mockNotifications[0] } as T;
  if (pathname === "/dashboard/summary" && method === "GET") return mockDashboardSummary() as T;
  if (/^\/projects\/[^/]+$/.test(pathname) && method === "GET") return { project: mockProjects[0] } as T;
  if (/^\/projects\/[^/]+$/.test(pathname) && method === "PATCH") {
    mockProjects[0] = { ...mockProjects[0]!, ...(options.body as Partial<Project>), updatedAt: new Date().toISOString() };
    return { project: mockProjects[0] } as T;
  }
  if (/^\/projects\/[^/]+\/tasks$/.test(pathname) && method === "GET") return { tasks: mockTasks } as T;
  if (/^\/projects\/[^/]+\/phases$/.test(pathname) && method === "GET") return { phases: mockPhaseData() } as T;
  if (/^\/projects\/[^/]+\/phases\/[^/]+\/branch$/.test(pathname) && method === "POST") {
    const phase = mockPhases.find((item) => item.id === pathname.split("/")[4]);
    if (!phase) throw new ApiError("Phase not found", 404);
    phase.branchName ??= `phase/${mockProjects[0]!.key.toLowerCase()}-${phase.number}`;
    return { branch: { phaseId: phase.id, branchName: phase.branchName } } as T;
  }
  if (/^\/projects\/[^/]+\/phases\/[^/]+\/merge-to-main$/.test(pathname) && method === "POST") {
    const phase = mockPhases.find((item) => item.id === pathname.split("/")[4]);
    if (!phase) throw new ApiError("Phase not found", 404);
    return { merge: { phaseId: phase.id, branchName: phase.branchName ?? `phase/${mockProjects[0]!.key.toLowerCase()}-${phase.number}`, target: "main" } } as T;
  }
  if (/^\/projects\/[^/]+\/tags$/.test(pathname) && method === "GET") return { tags: mockTags } as T;
  if (/^\/projects\/[^/]+\/automations$/.test(pathname) && method === "GET") return { automations: mockAutomations } as T;
  if (/^\/projects\/[^/]+\/automations$/.test(pathname) && method === "POST") {
    const input = options.body as AutomationCreate;
    const automation = { ...input, id: `automation-${Date.now()}`, projectId: "p_mobile", enabled: input.enabled ?? true, trigger: input.trigger ?? "TASK_UPDATED", actorType: input.actorType ?? "ANY", actorId: input.actorId ?? null, service: input.service ?? null, conditions: input.conditions ?? [], actions: input.actions, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Automation;
    mockAutomations = [automation, ...mockAutomations];
    return { automation } as T;
  }
  if (/^\/automations\/[^/]+$/.test(pathname) && method === "PATCH") {
    const id = pathname.split("/")[2]!;
    mockAutomations = mockAutomations.map((item) => item.id === id ? { ...item, ...(options.body as AutomationUpdate), updatedAt: new Date().toISOString() } : item);
    const automation = mockAutomations.find((item) => item.id === id);
    if (!automation) throw new ApiError("Automation not found", 404);
    return { automation } as T;
  }
  if (/^\/automations\/[^/]+$/.test(pathname) && method === "DELETE") { mockAutomations = mockAutomations.filter((item) => item.id !== pathname.split("/")[2]); return undefined as T; }
  if (pathname === "/search" && method === "GET") {
    const query = (url.searchParams.get("q") ?? "").toLowerCase();
    const results = mockTasks
      .filter((task) => `${task.title} ${task.description} MOB-${task.number}`.toLowerCase().includes(query))
      .map((task) => ({ ...task, projectName: "Mobile Refresh", projectKey: "MOB", projectColor: "#6554c0" }));
    return { results } as T;
  }
  if (pathname === "/context" && method === "GET") {
    const taskKey = url.searchParams.get("task");
    const taskNum = taskKey?.match(/-(\d+)$/)?.[1];
    return { project: mockProjects[0], task: taskNum ? (mockTasks.find((task) => task.number === Number(taskNum)) ?? null) : null } as T;
  }
  if (pathname === "/activity" && method === "GET") {
    const activity: ActivityEvent[] = mockTasks.slice(0, 6).map((task, index) => ({
      id: `a${index + 1}`,
      projectId: "p_mobile",
      projectKey: "MOB",
      taskId: task.id,
      taskNumber: task.number,
      actorId: task.assigneeId ?? MOCK_USER.id,
      actorName: task.assignee?.name ?? MOCK_USER.name,
      actorKind: task.assignee?.kind ?? MOCK_USER.kind,
      actorAvatarUrl: null,
      action: "task.updated",
      metadata: { status: task.status },
      createdAt: task.updatedAt,
    }));
    return { activity } as T;
  }
  if (pathname === "/users/agents/ops" && method === "GET") {
    return {
      agents: [{
        id: MOCK_AGENT.id,
        name: MOCK_AGENT.name,
        email: MOCK_AGENT.email,
        kind: MOCK_AGENT.kind,
        role: MOCK_AGENT.role,
        avatarUrl: null,
        webhookUrl: null,
        createdAt: MOCK_AGENT.createdAt,
        lastActiveAt: MOCK_NOW,
        openTaskCount: mockTasks.filter((task) => task.assigneeId === MOCK_AGENT.id && task.status !== "DONE" && task.status !== "CANCELLED").length,
        stuckTaskCount: 0,
        inProgressTasks: mockTasks
          .filter((task) => task.assigneeId === MOCK_AGENT.id && task.status === "IN_PROGRESS")
          .map((task) => ({ id: task.id, title: task.title, number: task.number, projectId: task.projectId, projectName: "Mobile Refresh", projectKey: "MOB", updatedAt: task.updatedAt, isStuck: false })),
      }],
    } as T;
  }

  if (/^\/tasks\/[^/]+$/.test(pathname) && method === "GET") {
    const id = pathname.split("/")[2]!;
    const task = mockTasks.find((item) => item.id === id);
    if (!task) throw new ApiError("Task not found", 404);
    return { task } as T;
  }
  if (/^\/tasks\/[^/]+$/.test(pathname) && method === "PATCH") {
    const id = pathname.split("/")[2]!;
    const index = mockTasks.findIndex((item) => item.id === id);
    if (index < 0) throw new ApiError("Task not found", 404);
    mockTasks[index] = { ...mockTasks[index]!, ...(options.body as Partial<Task>), updatedAt: new Date().toISOString() };
    return { task: mockTasks[index] } as T;
  }
  if (/^\/tasks\/[^/]+$/.test(pathname) && method === "DELETE") {
    const id = pathname.split("/")[2]!;
    mockTasks = mockTasks.filter((task) => task.id !== id);
    return undefined as T;
  }
  if (/^\/projects\/[^/]+\/tasks$/.test(pathname) && method === "POST") {
    const input = options.body as TaskCreate;
    const nextNumber = Math.max(0, ...mockTasks.map((task) => task.number)) + 1;
    const assignee = [MOCK_USER, MOCK_MEMBER, MOCK_AGENT].find((candidate) => candidate.id === input.assigneeId) ?? null;
    const created = makeMockTask(nextNumber, input.title, input.status ?? mockProjects[0]!.defaultStatus, input.priority, input.type, input.phaseId ?? null, assignee, []);
    created.description = input.description;
    created.definitionOfDone = input.definitionOfDone;
    created.branch = input.branch ?? null;
    created.dueDate = input.dueDate ?? null;
    created.estimatePoints = input.estimatePoints ?? null;
    created.pullRequestUrl = input.pullRequestUrl ?? null;
    created.pullRequestTitle = input.pullRequestTitle ?? null;
    created.pullRequestState = input.pullRequestState ?? null;
    created.tags = mockTags.filter((tag) => (input.tags ?? []).includes(tag.name));
    mockTasks.push(created);
    return { task: created } as T;
  }

  if (/^\/tasks\/[^/]+\/updates$/.test(pathname) && method === "GET") return { updates: [] } as T;
  if (/^\/tasks\/[^/]+\/runs$/.test(pathname) && method === "GET") return { runs: mockRuns[pathname.split("/")[2]!] ?? [] } as T;
  if (/^\/tasks\/[^/]+\/agent-logs$/.test(pathname) && method === "GET") return { agentLogs: mockAgentLogs[pathname.split("/")[2]!] ?? [], page: { limit: 100, hasMore: false, nextCursor: null } } as T;
  if (/^\/tasks\/[^/]+\/updates$/.test(pathname) && method === "POST") {
    return {
      update: {
        id: `u_${Math.random().toString(36).slice(2, 9)}`,
        taskId: pathname.split("/")[2]!,
        authorId: MOCK_USER.id,
        body: String((options.body as { body?: string })?.body ?? ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: MOCK_USER,
      },
    } as T;
  }
  if (/^\/tasks\/[^/]+\/attachments$/.test(pathname) && method === "GET") return { attachments: [] } as T;
  if (/^\/tasks\/[^/]+\/attachments$/.test(pathname) && method === "POST") {
    return { attachment: { id: "att_mock", taskId: pathname.split("/")[2]!, fileName: "mock.txt", mimeType: "text/plain", size: 12, createdAt: new Date().toISOString(), uploadedBy: MOCK_USER, downloadUrl: "#" } } as T;
  }
  if (/^\/attachments\/[^/]+$/.test(pathname) && method === "DELETE") return undefined as T;
  if (/^\/users\/[^/]+\/tokens$/.test(pathname) && method === "GET") return { tokens: [] } as T;
  if (/^\/users\/[^/]+\/tokens$/.test(pathname) && method === "POST") return { token: "tf_mock_token", prefix: "tf_mock", expiresAt: null, warning: "Mock mode token" } as T;
  if (/^\/users\/[^/]+\/tokens\/[^/]+\/reveal$/.test(pathname) && method === "POST") return { token: "tf_mock_token" } as T;
  if (/^\/users\/tokens\/[^/]+$/.test(pathname) && method === "DELETE") return undefined as T;
  if (/^\/users\/[^/]+\/webhook$/.test(pathname) && method === "PATCH") return { user: { ...MOCK_AGENT, webhookUrl: (options.body as { webhookUrl: string | null }).webhookUrl, webhookSecretConfigured: true }, webhookSecret: "whsec_mock" } as T;
  if (/^\/users\/[^/]+\/webhook-secret\/rotate$/.test(pathname) && method === "POST") return { user: { ...MOCK_AGENT, webhookSecretConfigured: true }, webhookSecret: "whsec_mock_rotated" } as T;
  if (pathname === "/users/webhook-deliveries" && method === "GET") return { deliveries: [] } as T;
  if (/^\/users\/webhook-deliveries\/[^/]+\/retry$/.test(pathname) && method === "POST") throw new ApiError("Mock delivery not found", 404);
  if (pathname === "/delivery-monitor/health" && method === "GET") return { monitor: { status: "healthy", lastSweepAt: MOCK_NOW, activeLeaseCount: 1, processedCount: 12, nextRetryAt: new Date(Date.now() + 45_000).toISOString(), failures: [{ runId: "00000000-0000-4000-8000-000000000001", taskId: "00000000-0000-4000-8000-000000000004", pullRequestUrl: "https://github.com/example/mobile-refresh/pull/4", retryCount: 1, nextRetryAt: new Date(Date.now() + 45_000).toISOString(), lastObservedAt: MOCK_NOW, state: "OPEN", errorCategory: "RATE_LIMIT" }] }, activeLeases: [{ runId: "00000000-0000-4000-8000-000000000001", ownerId: "smithy-demo", acquiredAt: MOCK_NOW, expiresAt: new Date(Date.now() + 90_000).toISOString() }] } as T;

  // Mutations used by settings and project management can no-op in mock mode.
  if (method !== "GET") return undefined as T;

  throw new ApiError(`Mock endpoint not implemented: ${method} ${pathname}`, 400);
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  if (USE_MOCK) return mockRequest<T>(path, options);
  const token = localStorage.getItem("taskforge_token");
  const hasBody = options.body !== undefined;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const validationDetail = Array.isArray(data.issues) && data.issues[0]?.message
      ? `: ${data.issues[0].message}`
      : "";
    throw new ApiError(`${data.error ?? "Request failed"}${validationDetail}`, response.status);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) => request<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }),
  me: () => request<{ user: User }>("/auth/me"),
  projects: () => request<{ projects: Project[] }>("/projects").then((response) => ({ projects: response.projects.map((project) => ({ ...project, localRepoPath: project.localRepoPath ?? null })) })),
  reorderProjects: (projectIds: string[]) => request<void>("/projects/order", { method: "PATCH", body: { projectIds } }),
  project: (id: string) => request<{ project: Project }>(`/projects/${id}`),
  addProjectMember: (projectId: string, userId: string) => request<void>(`/projects/${projectId}/members`, { method: "POST", body: { userId, role: "MEMBER" } }),
  removeProjectMember: (projectId: string, userId: string) => request<void>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
  phases: (projectId: string) => request<{ phases: Phase[] }>(`/projects/${projectId}/phases`),
  automations: (projectId: string) => request<{ automations: Automation[] }>(`/projects/${projectId}/automations`),
  createAutomation: (projectId: string, input: AutomationCreate) => request<{ automation: Automation }>(`/projects/${projectId}/automations`, { method: "POST", body: input }),
  updateAutomation: (id: string, input: AutomationUpdate) => request<{ automation: Automation }>(`/automations/${id}`, { method: "PATCH", body: input }),
  deleteAutomation: (id: string) => request<void>(`/automations/${id}`, { method: "DELETE" }),
  createPhase: (projectId: string, input: { number: number; goal: string; isActive: boolean }) => request<{ phase: Phase }>(`/projects/${projectId}/phases`, { method: "POST", body: input }),
  updatePhase: (id: string, input: Partial<{ number: number; goal: string; isActive: boolean }>) => request<{ phase: Phase }>(`/phases/${id}`, { method: "PATCH", body: input }),
  deletePhase: (id: string, input?: { taskAction?: "move" | "delete"; targetPhaseId?: string }) => request<void>(`/phases/${id}`, { method: "DELETE", body: input ?? {} }),
  ensurePhaseBranch: (projectId: string, phaseId: string) => request<{ branch: { phaseId: string; branchName: string } }>(`/projects/${projectId}/phases/${phaseId}/branch`, { method: "POST" }),
  mergePhaseToMain: (projectId: string, phaseId: string) => request<{ merge: { phaseId: string; branchName: string; target: "main" } }>(`/projects/${projectId}/phases/${phaseId}/merge-to-main`, { method: "POST" }),
  createProject: (input: { key: string; name: string; description: string; repoUrl: string | null; localRepoPath: string | null; color: string }) =>
    request<{ project: Project }>("/projects", { method: "POST", body: input }),
  updateProject: (id: string, input: { name?: string; description?: string; repoUrl?: string | null; localRepoPath?: string | null; color?: string; availableStatuses?: Project["availableStatuses"]; defaultStatus?: Project["defaultStatus"]; agentWorkflow?: Project["agentWorkflow"]; hiddenEmptyStatuses?: Project["hiddenEmptyStatuses"]; mergeTarget?: Project["mergeTarget"] }) =>
    request<{ project: Project }>(`/projects/${id}`, { method: "PATCH", body: input }),
  enableAgentWorkflow: (id: string) => request<{ project: Project }>(`/projects/${id}/agent-workflow/enable`, { method: "POST" }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  tasks: async (projectId: string) => {
    const tasks: Task[] = [];
    let cursor: string | null = null;
    do {
      const response: { tasks: Task[]; page?: PageInfo } = await request<{ tasks: Task[]; page?: PageInfo }>(`/projects/${projectId}/tasks?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      tasks.push(...response.tasks);
      cursor = response.page?.nextCursor ?? null;
    } while (cursor);
    return { tasks };
  },
  tags: (projectId: string) => request<{ tags: Tag[] }>(`/projects/${projectId}/tags`),
  task: (id: string) => request<{ task: Task }>(`/tasks/${id}`),
  createTask: (projectId: string, input: TaskCreate) => request<{ task: Task }>(`/projects/${projectId}/tasks`, { method: "POST", body: input }),
  updateTask: (id: string, input: TaskUpdate) => request<{ task: Task }>(`/tasks/${id}`, { method: "PATCH", body: input }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  taskUpdates: async (id: string) => {
    const updates: TaskNote[] = [];
    let cursor: string | null = null;
    do {
      const response: { updates: TaskNote[]; page?: PageInfo } = await request<{ updates: TaskNote[]; page?: PageInfo }>(`/tasks/${id}/updates?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      updates.push(...response.updates);
      cursor = response.page?.nextCursor ?? null;
    } while (cursor);
    return { updates };
  },
  taskRuns: (id: string) => request<{ runs: AgentRun[] }>(`/tasks/${id}/runs`),
  taskAgentLogs: async (id: string) => {
    const logs: AgentLog[] = []; let cursor: string | null = null;
    do {
      const response: { agentLogs: AgentLog[]; page?: PageInfo } = await request<{ agentLogs: AgentLog[]; page?: PageInfo }>(`/tasks/${id}/agent-logs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      logs.push(...response.agentLogs); cursor = response.page?.nextCursor ?? null;
    } while (cursor);
    return { agentLogs: logs };
  },
  addTaskUpdate: (id: string, body: string) => request<{ update: TaskNote }>(`/tasks/${id}/updates`, { method: "POST", body: { body } }),
  taskAttachments: (id: string) => request<{ attachments: Attachment[] }>(`/tasks/${id}/attachments`),
  uploadTaskAttachment: (id: string, input: { fileName: string; mimeType: string; data: string }) => request<{ attachment: Attachment }>(`/tasks/${id}/attachments`, { method: "POST", body: input }),
  deleteTaskAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: "DELETE" }),
  downloadTaskAttachment: async (id: string) => { const token = localStorage.getItem("taskforge_token"); const response = await fetch(`${API_URL}/attachments/${id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (!response.ok) throw new ApiError("Could not download attachment", response.status); return response.blob(); },
  users: () => request<{ users: User[] }>("/users"),
  updateProfile: (input: { name: string; email: string }) => request<{ user: User }>("/users/me", { method: "PATCH", body: input }),
  createAgent: (input: { name: string; email?: string }) => request<{ user: User }>("/users/agents", { method: "POST", body: input }),
  uploadUserAvatar: (userId: string, input: { mimeType: string; data: string }) => request<{ user: User }>(`/users/${userId}/avatar`, { method: "POST", body: input }),
  deleteUserAvatar: (userId: string) => request<{ user: User }>(`/users/${userId}/avatar`, { method: "DELETE" }),
  deleteAgent: (userId: string) => request<void>(`/users/${userId}`, { method: "DELETE" }),
  agentTokens: (userId: string) => request<{ tokens: ApiTokenMetadata[] }>(`/users/${userId}/tokens`),
  createAgentToken: (userId: string, input: { name: string; expiresInDays: number | null; permissions?: string[] | null }) => request<{ token: string; prefix: string; expiresAt: string | null; warning: string }>(`/users/${userId}/tokens`, { method: "POST", body: input }),
  revealAgentToken: (userId: string, tokenId: string) => request<{ token: string }>(`/users/${userId}/tokens/${tokenId}/reveal`, { method: "POST" }),
  revokeAgentToken: (id: string) => request<void>(`/users/tokens/${id}`, { method: "DELETE" }),
  notifications: () => request<{ notifications: Notification[]; unreadCount: number; page?: PageInfo }>("/notifications"),
  readNotification: (id: string) => request<{ notification: Notification }>(`/notifications/${id}/read`, { method: "PATCH" }),
  readAllNotifications: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  search: (query: string) => request<{ results: TaskSearchResult[]; page?: PageInfo }>(`/search?q=${encodeURIComponent(query)}`),
  context: (params: { project?: string; task?: string }) => request<{ project: Project; task: Task | null }>(`/context?${new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString()}`),
  taskActivity: (taskId: string, limit = 30) => request<{ activity: ActivityEvent[]; page?: PageInfo }>(`/activity?taskId=${taskId}&limit=${limit}`),
  projectActivity: (projectId: string, limit = 50) => request<{ activity: ActivityEvent[]; page?: PageInfo }>(`/activity?projectId=${projectId}&limit=${limit}`),
  activityFeed: (limit = 50) => request<{ activity: ActivityEvent[]; page?: PageInfo }>(`/activity?limit=${limit}`),
  agentOps: () => request<{ agents: AgentOpsEntry[] }>("/users/agents/ops"),
  updateAgentWebhook: (agentId: string, webhookUrl: string | null) => request<{ user: User; webhookSecret?: string }>(`/users/${agentId}/webhook`, { method: "PATCH", body: { webhookUrl } }),
  rotateAgentWebhookSecret: (agentId: string) => request<{ user: User; webhookSecret: string }>(`/users/${agentId}/webhook-secret/rotate`, { method: "POST" }),
  webhookDeliveries: (filters: { agentId?: string; status?: WebhookDeliveryStatus; limit?: number } = {}) => request<{ deliveries: WebhookDelivery[] }>(`/users/webhook-deliveries?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  retryWebhookDelivery: (deliveryId: string) => request<{ delivery: WebhookDelivery }>(`/users/webhook-deliveries/${deliveryId}/retry`, { method: "POST" }),
  claimTask: (projectId: string, opts?: { phaseId?: string | null; priority?: string }) => request<{ task: Task }>(`/projects/${projectId}/tasks/claim`, { method: "POST", body: opts ?? {} }),
  dashboardSummary: () => request<DashboardSummary>("/dashboard/summary"),
  deliveryMonitorHealth: () => request<{ monitor: DeliveryMonitorHealth; activeLeases: Array<{ runId: string; ownerId: string; acquiredAt: string; expiresAt: string }> }>("/delivery-monitor/health"),
};
