import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import bcrypt from "bcryptjs";

const testDir = mkdtempSync(path.join(tmpdir(), "taskforge-test-"));
process.env.DATABASE_PATH = path.join(testDir, "test.db");
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

before(async () => {
  const now = new Date().toISOString();
  const password = await bcrypt.hash("password123", 8);
  db.prepare("INSERT INTO users (id, email, name, password_hash, kind, role, created_at) VALUES (?, ?, ?, ?, 'HUMAN', 'ADMIN', ?)")
    .run(adminId, "admin@example.com", "Admin", password, now);
  db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)")
    .run(agentId, "agent@example.com", "Test Agent", now);
});

after(async () => {
  await app.close();
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

test("health endpoint is public", async () => {
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
  assert.equal(created.statusCode, 201);
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
    payload: { title: "Agent-ready task", description: "", definitionOfDone: "A passing test", assigneeId: agentId, status: "TODO", priority: "HIGH", estimatePoints: 5 },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().task.number, 1);
  assert.equal(created.json().task.phaseId, phaseId);
  taskId = created.json().task.id;

  const updated = await app.inject({
    method: "PATCH", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { status: "IN_PROGRESS", branch: "agent/test-task", pullRequestUrl: "https://github.com/example/repo/pull/17", pullRequestTitle: "Add agent-ready task", pullRequestState: "OPEN" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().task.status, "IN_PROGRESS");
  assert.equal(updated.json().task.branch, "agent/test-task");
  assert.equal(updated.json().task.pullRequestState, "OPEN");
});

test("an issued agent token authenticates and is scoped by membership", async () => {
  const issued = await app.inject({
    method: "POST", url: `/api/users/${agentId}/tokens`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "CI token", expiresInDays: 30 },
  });
  assert.equal(issued.statusCode, 201);
  assert.match(issued.json().token, /^tf_/);

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
  assert.equal(tasks.json().tasks[0].id, taskId);

  const filteredTasks = await app.inject({
    method: "GET", url: `/api/projects/${projectId}/tasks?priority=HIGH&phaseId=${phaseId}&minPoints=3&maxPoints=8`, headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(filteredTasks.statusCode, 200);
  assert.equal(filteredTasks.json().tasks.length, 1);

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
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().results[0].id, taskId);

  const context = await app.inject({
    method: "GET", url: "/api/context?project=API&task=API-1", headers: { authorization: `Bearer ${issued.json().token}` },
  });
  assert.equal(context.statusCode, 200);
  assert.equal(context.json().project.id, projectId);
  assert.equal(context.json().task.id, taskId);
});

test("unauthenticated project access is rejected", async () => {
  const response = await app.inject({ method: "GET", url: "/api/projects" });
  assert.equal(response.statusCode, 401);
});
