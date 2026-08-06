import type { ApiTokenMetadata, AuthResponse, Notification, Phase, Project, Task, TaskCreate, TaskNote, TaskSearchResult, TaskUpdate, User } from "@taskforge/contracts";

// In development, Vite proxies /api to the backend. Keeping the browser on one
// origin avoids localhost/127.0.0.1 CORS differences. Deployments can still set
// VITE_API_URL when the API lives on a separate origin.
const API_URL = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/$/, "");

type Options = Omit<RequestInit, "body"> & { body?: unknown };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
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
  projects: () => request<{ projects: Project[] }>("/projects"),
  project: (id: string) => request<{ project: Project }>(`/projects/${id}`),
  phases: (projectId: string) => request<{ phases: Phase[] }>(`/projects/${projectId}/phases`),
  createPhase: (projectId: string, input: { number: number; goal: string; isActive: boolean }) => request<{ phase: Phase }>(`/projects/${projectId}/phases`, { method: "POST", body: input }),
  updatePhase: (id: string, input: Partial<{ number: number; goal: string; isActive: boolean }>) => request<{ phase: Phase }>(`/phases/${id}`, { method: "PATCH", body: input }),
  deletePhase: (id: string) => request<void>(`/phases/${id}`, { method: "DELETE" }),
  createProject: (input: { key: string; name: string; description: string; repoUrl: string | null; color: string }) =>
    request<{ project: Project }>("/projects", { method: "POST", body: input }),
  tasks: (projectId: string) => request<{ tasks: Task[] }>(`/projects/${projectId}/tasks`),
  task: (id: string) => request<{ task: Task }>(`/tasks/${id}`),
  createTask: (projectId: string, input: TaskCreate) => request<{ task: Task }>(`/projects/${projectId}/tasks`, { method: "POST", body: input }),
  updateTask: (id: string, input: TaskUpdate) => request<{ task: Task }>(`/tasks/${id}`, { method: "PATCH", body: input }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  taskUpdates: (id: string) => request<{ updates: TaskNote[] }>(`/tasks/${id}/updates`),
  addTaskUpdate: (id: string, body: string) => request<{ update: TaskNote }>(`/tasks/${id}/updates`, { method: "POST", body: { body } }),
  users: () => request<{ users: User[] }>("/users"),
  updateProfile: (input: { name: string; email: string }) => request<{ user: User }>("/users/me", { method: "PATCH", body: input }),
  createAgent: (input: { name: string; email?: string }) => request<{ user: User }>("/users/agents", { method: "POST", body: input }),
  agentTokens: (userId: string) => request<{ tokens: ApiTokenMetadata[] }>(`/users/${userId}/tokens`),
  createAgentToken: (userId: string, input: { name: string; expiresInDays: number | null }) => request<{ token: string; prefix: string; expiresAt: string | null; warning: string }>(`/users/${userId}/tokens`, { method: "POST", body: input }),
  revokeAgentToken: (id: string) => request<void>(`/users/tokens/${id}`, { method: "DELETE" }),
  notifications: () => request<{ notifications: Notification[]; unreadCount: number }>("/notifications"),
  readNotification: (id: string) => request<{ notification: Notification }>(`/notifications/${id}/read`, { method: "PATCH" }),
  readAllNotifications: () => request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  search: (query: string) => request<{ results: TaskSearchResult[] }>(`/search?q=${encodeURIComponent(query)}`),
  context: (params: { project?: string; task?: string }) => request<{ project: Project; task: Task | null }>(`/context?${new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString()}`),
};
