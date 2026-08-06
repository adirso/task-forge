import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";

const testDir = mkdtempSync(path.join(tmpdir(), "taskforge-test-"));
const mysqlTestUrl = process.env.TEST_DATABASE_URL;
if (mysqlTestUrl) {
  process.env.DATABASE_DRIVER = "mysql";
  process.env.DATABASE_URL = mysqlTestUrl;
} else {
  process.env.DATABASE_DRIVER = "sqlite";
  process.env.DATABASE_PATH = path.join(testDir, "test.db");
}
process.env.JWT_SECRET = "test-secret-at-least-long-enough";
process.env.TEST = "1";

const { db } = await import("../src/db/database.js");
const { buildApp } = await import("../src/app.js");
const app = await buildApp();

const adminId = randomUUID();
const agentId = randomUUID();
let jwtToken = "";
let projectId = "";
let taskId = "";
let phaseId = "";
let agentToken = "";

before(async () => {
  const now = new Date().toISOString();
  const password = await bcrypt.hash("password123", 8);
  await db.prepare("INSERT INTO users (id, email, name, password_hash, kind, role, created_at) VALUES (?, ?, ?, ?, 'HUMAN', 'ADMIN', ?)")
    .run(adminId, "admin@example.com", "Admin", password, now);
  await db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)")
    .run(agentId, "agent@example.com", "Test Agent", now);
});

after(async () => {
  await app.close();
  await db.close();
  if (!mysqlTestUrl) rmSync(testDir, { recursive: true, force: true });
});

test("health endpoint is public", async () => {
  assert.equal(db.dialect, mysqlTestUrl ? "mysql" : "sqlite");
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("human can log in and create a project", async () => {
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "password123" } });
  assert.equal(login.statusCode, 200);
  jwtToken = login.json().token;

  const created = await app.inject({
    method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` },
    payload: { key: "API", name: "API project", description: "Integration test", color: "#6554C0" },
  });
  assert.equal(created.statusCode, 201, created.body);
  projectId = created.json().project.id;

  const profile = await app.inject({
    method: "PATCH", url: "/api/users/me", headers: { authorization: `Bearer ${jwtToken}` },
    payload: { name: "Admin User", email: "admin@example.com" },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().user.name, "Admin User");

  const phases = await app.inject({ method: "GET", url: `/api/projects/${projectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(phases.statusCode, 200);
  assert.equal(phases.json().phases[0].isActive, true);
  const project = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(project.statusCode, 200);
  assert.equal(project.json().project.members[0].projectRole, "OWNER");
  const nextPhase = await app.inject({ method: "POST", url: `/api/projects/${projectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { number: 2, goal: "Deliver the integration", isActive: true } });
  assert.equal(nextPhase.statusCode, 201);
  assert.equal(nextPhase.json().phase.isActive, true);
  phaseId = nextPhase.json().phase.id;
});

test("task lifecycle supports assignment and status changes", async () => {
  const addMember = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/members`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { userId: agentId, role: "MEMBER" },
  });
  assert.equal(addMember.statusCode, 204);

  const created = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { title: "Agent-ready task", description: "", definitionOfDone: "A passing test", assigneeId: agentId, status: "TODO", priority: "HIGH", estimatePoints: 5, tags: ["Frontend", "backend", "frontend"] },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().task.number, 1);
  assert.equal(created.json().task.phaseId, phaseId);
  assert.deepEqual(created.json().task.tags.map((tag: { name: string }) => tag.name), ["backend", "frontend"]);
  taskId = created.json().task.id;

  const blocker = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { title: "Dependency blocker", description: "Must be completed first.", status: "TODO", priority: "MEDIUM" },
  });
  assert.equal(blocker.statusCode, 201, blocker.body);
  const blockerId = blocker.json().task.id as string;
  const createdWithDependency = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { title: "Task created with dependency", status: "TODO", priority: "LOW", dependencyIds: [blockerId] },
  });
  assert.equal(createdWithDependency.statusCode, 201, createdWithDependency.body);
  assert.equal(createdWithDependency.json().task.dependencies[0].dependsOnTaskId, blockerId);

  const updated = await app.inject({
    method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { status: "IN_PROGRESS", branch: "agent/test-task", pullRequestUrl: "https://github.com/example/repo/pull/17", pullRequestTitle: "Add agent-ready task", pullRequestState: "OPEN", tags: ["api", "backend"], dependencyIds: [blockerId] },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().task.status, "IN_PROGRESS");
  assert.equal(updated.json().task.branch, "agent/test-task");
  assert.equal(updated.json().task.pullRequestState, "OPEN");
  assert.deepEqual(updated.json().task.tags.map((tag: { name: string }) => tag.name), ["api", "backend"]);
  assert.deepEqual(updated.json().task.dependencies.map((dependency: { dependsOnTaskId: string }) => dependency.dependsOnTaskId), [blockerId]);
  assert.equal(updated.json().task.dependencies[0].isBlocking, true);

  const persisted = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(persisted.statusCode, 200);
  assert.deepEqual(persisted.json().task.tags.map((tag: { name: string }) => tag.name), ["api", "backend"]);
  assert.equal(persisted.json().task.dependencies[0].title, "Dependency blocker");

  const completedBlocker = await app.inject({ method: "PATCH", url: `/api/tasks/${blockerId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { status: "DONE" } });
  assert.equal(completedBlocker.statusCode, 200);
  const resolved = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(resolved.json().task.dependencies[0].status, "DONE");
  assert.equal(resolved.json().task.dependencies[0].isBlocking, false);

  const selfDependency = await app.inject({ method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { dependencyIds: [taskId] } });
  assert.equal(selfDependency.statusCode, 400);
  const cyclicDependency = await app.inject({ method: "PATCH", url: `/api/tasks/${blockerId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { dependencyIds: [taskId] } });
  assert.equal(cyclicDependency.statusCode, 400);
  const removedDependency = await app.inject({ method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { dependencyIds: [] } });
  assert.equal(removedDependency.statusCode, 200);
  assert.deepEqual(removedDependency.json().task.dependencies, []);

  const removed = await app.inject({ method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { tags: [] } });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json().task.tags, []);
  const restored = await app.inject({ method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { tags: ["api", "backend"] } });
  assert.equal(restored.statusCode, 200);

  const reusable = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tags`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(reusable.statusCode, 200);
  assert.deepEqual(reusable.json().tags.map((tag: { name: string }) => tag.name), ["api", "backend", "frontend"]);
});

test("task tag input is validated without changing persisted tags", async () => {
  const invalid = await app.inject({
    method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { tags: ["not a valid tag"] },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);

  const tooMany = await app.inject({
    method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) },
  });
  assert.equal(tooMany.statusCode, 400, tooMany.body);

  const persisted = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.deepEqual(persisted.json().task.tags.map((tag: { name: string }) => tag.name), ["api", "backend"]);
});

test("concurrent task creation allocates unique project numbers", async () => {
  const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/tasks`,
    headers: { authorization: `Bearer ${jwtToken}` },
    payload: { title: `Concurrent task ${index + 1}`, status: "TODO", priority: "MEDIUM" },
  })));

  for (const response of responses) assert.equal(response.statusCode, 201, response.body);
  const numbers = responses.map((response) => Number(response.json().task.number));
  assert.equal(new Set(numbers).size, responses.length);
});

test("an issued agent token authenticates and is scoped by membership", async () => {
  const issued = await app.inject({
    method: "POST", url: `/api/users/${agentId}/tokens`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "CI token", expiresInDays: 30 },
  });
  assert.equal(issued.statusCode, 201);
  assert.match(issued.json().token, /^tf_/);
  agentToken = issued.json().token;

  const postedUpdate = await app.inject({
    method: "POST", url: `/api/tasks/${taskId}/updates`, headers: { authorization: `Bearer ${issued.json().token}` },
    payload: { body: "Implementation is complete and the PR is ready for review." },
  });
  assert.equal(postedUpdate.statusCode, 201);
  assert.equal(postedUpdate.json().update.authorId, agentId);

  const taskUpdates = await app.inject({
    method: "GET", url: `/api/tasks/${taskId}/updates`, headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(taskUpdates.statusCode, 200);
  assert.equal(taskUpdates.json().updates[0].body, "Implementation is complete and the PR is ready for review.");

  const tasks = await app.inject({
    method: "GET", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(tasks.statusCode, 200);
  assert.ok(tasks.json().tasks.some((task: { id: string }) => task.id === taskId));

  const filteredTasks = await app.inject({
    method: "GET", url: `/api/projects/${projectId}/tasks?priority=HIGH&phaseId=${phaseId}&tag=api&minPoints=3&maxPoints=8`, headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(filteredTasks.statusCode, 200);
  assert.equal(filteredTasks.json().tasks.length, 1);
  assert.equal(filteredTasks.json().tasks[0].tags[0].name, "api");

  const noTagMatch = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tasks?tag=frontend`, headers: { authorization: `Bearer ${issued.json().token}` } });
  assert.equal(noTagMatch.statusCode, 200);
  assert.equal(noTagMatch.json().tasks.length, 0);

  const notifications = await app.inject({
    method: "GET", url: "/api/notifications", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(notifications.statusCode, 200);
  assert.equal(notifications.json().unreadCount, 1);
  assert.equal(notifications.json().notifications[0].taskId, taskId);

  const readAll = await app.inject({
    method: "POST", url: "/api/notifications/read-all", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(readAll.statusCode, 200);
  assert.equal(readAll.json().updated, 1);

  const afterRead = await app.inject({
    method: "GET", url: "/api/notifications", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(afterRead.json().unreadCount, 0);

  const search = await app.inject({
    method: "GET", url: "/api/search?q=Agent-ready", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().results[0].id, taskId);

  const context = await app.inject({
    method: "GET", url: "/api/context?project=API&task=API-1", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(context.statusCode, 200);
  assert.equal(context.json().project.id, projectId);
  assert.equal(context.json().task.id, taskId);
});

test("only owners and administrators can manage project membership", async () => {
  const forbidden = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/members`, headers: { authorization: `Bearer ${agentToken}` },
    payload: { userId: adminId, role: "MEMBER" },
  });
  assert.equal(forbidden.statusCode, 403);

  const protectedOwner = await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/members/${adminId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(protectedOwner.statusCode, 400);

  const removed = await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/members/${agentId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(removed.statusCode, 204);

  const inaccessible = await app.inject({ method: "GET", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${agentToken}` } });
  assert.equal(inaccessible.statusCode, 403);

  const task = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(task.statusCode, 200);
  assert.equal(task.json().task.assigneeId, null);
});

test("unauthenticated project access is rejected", async () => {
  const response = await app.inject({ method: "GET", url: "/api/projects" });
  assert.equal(response.statusCode, 401);
});

test("only an owner or administrator can delete a project", async () => {
  const forbidden = await app.inject({ method: "DELETE", url: `/api/projects/${projectId}`, headers: { authorization: `Bearer ${agentToken}` } });
  assert.equal(forbidden.statusCode, 403);

  const created = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "DEL", name: "Delete me", description: "Temporary project", color: "#DE350B" } });
  const temporaryId = created.json().project.id;
  const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${temporaryId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(deleted.statusCode, 204);
  const missing = await app.inject({ method: "GET", url: `/api/projects/${temporaryId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(missing.statusCode, 404);
});

test("administrators can delete an unused agent identity", async () => {
  const created = await app.inject({ method: "POST", url: "/api/users/agents", headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "Disposable Agent" } });
  const disposableId = created.json().user.id as string;
  const forbidden = await app.inject({ method: "DELETE", url: `/api/users/${disposableId}`, headers: { authorization: `Bearer ${agentToken}` } });
  assert.equal(forbidden.statusCode, 403);
  const deleted = await app.inject({ method: "DELETE", url: `/api/users/${disposableId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(deleted.statusCode, 204, deleted.body);
  const users = await app.inject({ method: "GET", url: "/api/users", headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(users.json().users.some((user: { id: string }) => user.id === disposableId), false);
});
