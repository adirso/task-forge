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
const memberId = randomUUID();
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
  await db.prepare("INSERT INTO users (id, email, name, password_hash, kind, role, created_at) VALUES (?, ?, ?, ?, 'HUMAN', 'MEMBER', ?)")
    .run(memberId, "member@example.com", "Project Member", password, now);
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

test("delivery monitor diagnostics require authentication and expose safe idle state", async () => {
  const denied = await app.inject({ method: "GET", url: "/api/delivery-monitor/health" });
  assert.equal(denied.statusCode, 401);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "password123" } });
  const response = await app.inject({ method: "GET", url: "/api/delivery-monitor/health", headers: { authorization: `Bearer ${login.json().token}` } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.monitor.status, "idle");
  assert.equal(body.monitor.activeLeaseCount, 0);
  assert.ok(Array.isArray(body.monitor.failures));
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
  const duplicatePhase = await app.inject({ method: "POST", url: `/api/projects/${projectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { number: 2, goal: "Duplicate", isActive: false } });
  assert.equal(duplicatePhase.statusCode, 409);
  const emptyPhase = await app.inject({ method: "POST", url: `/api/projects/${projectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { number: 3, goal: "A future empty phase", isActive: false } });
  assert.equal(emptyPhase.statusCode, 201);
  const emptyPhaseId = emptyPhase.json().phase.id as string;
  const listedWithEmpty = await app.inject({ method: "GET", url: `/api/projects/${projectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(listedWithEmpty.json().phases.find((phase: { id: string }) => phase.id === emptyPhaseId).taskCount, 0);
  const updatedEmpty = await app.inject({ method: "PATCH", url: `/api/phases/${emptyPhaseId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { goal: "Updated future phase" } });
  assert.equal(updatedEmpty.statusCode, 200);
  assert.equal(updatedEmpty.json().phase.goal, "Updated future phase");
  const deletedEmpty = await app.inject({ method: "DELETE", url: `/api/phases/${emptyPhaseId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(deletedEmpty.statusCode, 204);
});

test("deleting a phase with tasks requires move or delete disposition", async () => {
  const createdProject = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: `PHD${randomUUID().slice(0, 4)}`, name: "Phase delete", description: "Disposition", color: "#654321" } });
  const disposeProjectId = createdProject.json().project.id as string;
  const listed = await app.inject({ method: "GET", url: `/api/projects/${disposeProjectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` } });
  const sourcePhaseId = listed.json().phases[0].id as string;
  const targetPhase = await app.inject({ method: "POST", url: `/api/projects/${disposeProjectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { number: 2, goal: "Keep these tasks", isActive: false } });
  assert.equal(targetPhase.statusCode, 201, targetPhase.body);
  const targetPhaseId = targetPhase.json().phase.id as string;
  const createdTask = await app.inject({ method: "POST", url: `/api/projects/${disposeProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Needs a new home", phaseId: sourcePhaseId, status: "TODO" } });
  assert.equal(createdTask.statusCode, 201, createdTask.body);
  const taskId = createdTask.json().task.id as string;

  const rejected = await app.inject({ method: "DELETE", url: `/api/phases/${sourcePhaseId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(rejected.statusCode, 400, rejected.body);

  const moved = await app.inject({ method: "DELETE", url: `/api/phases/${sourcePhaseId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { taskAction: "move", targetPhaseId } });
  assert.equal(moved.statusCode, 204, moved.body);
  const afterMove = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(afterMove.statusCode, 200, afterMove.body);
  assert.equal(afterMove.json().task.phaseId, targetPhaseId);

  const another = await app.inject({ method: "POST", url: `/api/projects/${disposeProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Delete with phase", phaseId: targetPhaseId, status: "TODO" } });
  assert.equal(another.statusCode, 201, another.body);
  const deletedWithTasks = await app.inject({ method: "DELETE", url: `/api/phases/${targetPhaseId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { taskAction: "delete" } });
  assert.equal(deletedWithTasks.statusCode, 204, deletedWithTasks.body);
  const gone = await app.inject({ method: "GET", url: `/api/tasks/${another.json().task.id}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(gone.statusCode, 404, gone.body);
  const cleaned = await app.inject({ method: "DELETE", url: `/api/projects/${disposeProjectId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(cleaned.statusCode, 204, cleaned.body);
});

test("project owners can update project details", async () => {
  const updated = await app.inject({ method: "PATCH", url: `/api/projects/${projectId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "Updated API project", repoUrl: "https://github.com/example/updated", color: "#123456", hiddenEmptyStatuses: ["BACKLOG"] } });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().project.name, "Updated API project");
  assert.equal(updated.json().project.repoUrl, "https://github.com/example/updated");
  assert.equal(updated.json().project.color, "#123456");
  assert.deepEqual(updated.json().project.hiddenEmptyStatuses, ["BACKLOG"]);
  const persisted = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(persisted.json().project.name, "Updated API project");
});

test("phase summaries include completed and cancelled task counts", async () => {
  const createdProject = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: `SUM${randomUUID().slice(0, 4)}`, name: "Phase summary", description: "Counts", color: "#123456" } });
  const summaryProjectId = createdProject.json().project.id as string;
  const initialPhases = await app.inject({ method: "GET", url: `/api/projects/${summaryProjectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` } });
  const summaryPhaseId = initialPhases.json().phases[0].id as string;
  const done = await app.inject({ method: "POST", url: `/api/projects/${summaryProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Completed phase task", phaseId: summaryPhaseId, status: "DONE" } });
  assert.equal(done.statusCode, 201, done.body);
  const cancelled = await app.inject({ method: "POST", url: `/api/projects/${summaryProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Cancelled phase task", phaseId: summaryPhaseId, status: "CANCELLED" } });
  assert.equal(cancelled.statusCode, 201, cancelled.body);
  const response = await app.inject({ method: "GET", url: `/api/projects/${summaryProjectId}/phases`, headers: { authorization: `Bearer ${jwtToken}` } });
  const summary = response.json().phases.find((phase: { id: string }) => phase.id === summaryPhaseId);
  assert.equal(summary.taskCount, 2);
  assert.equal(summary.completedTaskCount, 1);
  assert.equal(summary.cancelledTaskCount, 1);
  const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${summaryProjectId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(deleted.statusCode, 204);
});

test("projects configure available statuses and the default API status", async () => {
  const created = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "STS", name: "Status project", description: "Custom status coverage", color: "#00A3BF" } });
  assert.equal(created.statusCode, 201, created.body);
  const statusProject = created.json().project;
  assert.deepEqual(statusProject.availableStatuses, ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "FIX_NEEDED", "FIX_IN_PROGRESS", "RE_REVIEW", "APPROVED", "PENDING_DECISION", "CANCELLED", "FAILED", "DONE"]);
  assert.equal(statusProject.defaultStatus, "TODO");
  assert.equal(statusProject.agentWorkflow.implementationQueue, "TODO");
  const fetchedStatusProject = await app.inject({ method: "GET", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(fetchedStatusProject.statusCode, 200, fetchedStatusProject.body);
  assert.equal(fetchedStatusProject.json().project.agentWorkflow.reviewHandoff, "READY_FOR_REVIEW");

  const memberLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.com", password: "password123" } });
  assert.equal(memberLogin.statusCode, 200, memberLogin.body);
  const addMember = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId: memberId, role: "MEMBER" } });
  assert.equal(addMember.statusCode, 204, addMember.body);
  const forbiddenConfiguration = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${memberLogin.json().token}` }, payload: { defaultStatus: "REFINING" } });
  assert.equal(forbiddenConfiguration.statusCode, 403, forbiddenConfiguration.body);
  assert.match(forbiddenConfiguration.json().error, /project owner or an administrator/);

  for (const status of ["REFINING", "READY_FOR_REVIEW", "CANCELLED"]) {
    const task = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: `${status} task`, status } });
    assert.equal(task.statusCode, 201, task.body);
    assert.equal(task.json().task.status, status);
  }

  const configured = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: ["CANCELLED", "READY_FOR_REVIEW", "REFINING"], defaultStatus: "REFINING" } });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.deepEqual(configured.json().project.availableStatuses, ["REFINING", "READY_FOR_REVIEW", "CANCELLED"]);
  assert.equal(configured.json().project.defaultStatus, "REFINING");

  const unavailableWorkflow = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: {
    agentWorkflow: { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "FIX_IN_PROGRESS", reReview: "RE_REVIEW" },
  } });
  assert.equal(unavailableWorkflow.statusCode, 400, unavailableWorkflow.body);
  assert.match(unavailableWorkflow.json().error, /Enable these statuses before assigning workflow roles/);

  const defaulted = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Uses project default" } });
  assert.equal(defaulted.statusCode, 201, defaulted.body);
  assert.equal(defaulted.json().task.status, "REFINING");

  const unavailable = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Unavailable status", status: "TODO" } });
  assert.equal(unavailable.statusCode, 400, unavailable.body);
  assert.match(unavailable.json().error, /not available/);

  const invalidDefault = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { defaultStatus: "TODO" } });
  assert.equal(invalidDefault.statusCode, 400, invalidDefault.body);

  const statusInUse = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: ["READY_FOR_REVIEW", "CANCELLED"], defaultStatus: "READY_FOR_REVIEW" } });
  assert.equal(statusInUse.statusCode, 400, statusInUse.body);
  assert.match(statusInUse.json().error, /Move tasks out of REFINING/);

  const clearedWorkflow = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { agentWorkflow: null } });
  assert.equal(clearedWorkflow.statusCode, 200, clearedWorkflow.body);
  assert.equal(clearedWorkflow.json().project.agentWorkflow, null);
  const enabledWorkflow = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/agent-workflow/enable`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(enabledWorkflow.statusCode, 200, enabledWorkflow.body);
  assert.equal(enabledWorkflow.json().project.agentWorkflow.approved, "APPROVED");
  assert.ok(enabledWorkflow.json().project.availableStatuses.includes("FIX_IN_PROGRESS"));
  const customWorkflow = await app.inject({ method: "PATCH", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { agentWorkflow: { implementationQueue: "REFINING", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "FIX_IN_PROGRESS", reReview: "RE_REVIEW" } } });
  assert.equal(customWorkflow.statusCode, 200, customWorkflow.body);
  assert.equal(customWorkflow.json().project.agentWorkflow.implementationQueue, "REFINING");
  const memberEnable = await app.inject({ method: "POST", url: `/api/projects/${statusProject.id}/agent-workflow/enable`, headers: { authorization: `Bearer ${memberLogin.json().token}` } });
  assert.equal(memberEnable.statusCode, 403, memberEnable.body);
  assert.match(memberEnable.json().error, /project owner or an administrator/);
  const removed = await app.inject({ method: "DELETE", url: `/api/projects/${statusProject.id}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(removed.statusCode, 204, removed.body);
});

test("task claiming respects enabled project statuses and remains race-safe", async () => {
  const claimProjectResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "CLM", name: "Claim workflow", description: "Status-aware claim coverage", color: "#0052CC" } });
  assert.equal(claimProjectResponse.statusCode, 201, claimProjectResponse.body);
  const claimProjectId = claimProjectResponse.json().project.id as string;
  const configured = await app.inject({ method: "PATCH", url: `/api/projects/${claimProjectId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: ["TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "DONE"], defaultStatus: "TODO" } });
  assert.equal(configured.statusCode, 200, configured.body);
  const readyTask = await app.inject({ method: "POST", url: `/api/projects/${claimProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Ready to claim", priority: "HIGH" } });
  assert.equal(readyTask.statusCode, 201, readyTask.body);
  assert.equal(readyTask.json().task.status, "TODO");

  const claims = await Promise.all([1, 2].map(() => app.inject({ method: "POST", url: `/api/projects/${claimProjectId}/tasks/claim`, headers: { authorization: `Bearer ${jwtToken}` }, payload: {} })));
  assert.deepEqual(claims.map(({ statusCode }) => statusCode).sort((left, right) => left - right), [200, 404]);
  const winner = claims.find(({ statusCode }) => statusCode === 200)!;
  assert.equal(winner.json().task.id, readyTask.json().task.id);
  assert.equal(winner.json().task.status, "IN_PROGRESS");
  assert.equal(winner.json().task.assigneeId, adminId);

  const missingTargetResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "NTG", name: "No claim target", description: "", color: "#FF5630" } });
  assert.equal(missingTargetResponse.statusCode, 201, missingTargetResponse.body);
  const missingTargetId = missingTargetResponse.json().project.id as string;
  await app.inject({ method: "PATCH", url: `/api/projects/${missingTargetId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: ["TODO", "DONE"], defaultStatus: "TODO" } });
  const missingTargetClaim = await app.inject({ method: "POST", url: `/api/projects/${missingTargetId}/tasks/claim`, headers: { authorization: `Bearer ${jwtToken}` }, payload: {} });
  assert.equal(missingTargetClaim.statusCode, 400, missingTargetClaim.body);
  assert.match(missingTargetClaim.json().error, /requires IN_PROGRESS to be enabled.*project settings/);

  const missingSourceResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "NSR", name: "No claim source", description: "", color: "#36B37E" } });
  assert.equal(missingSourceResponse.statusCode, 201, missingSourceResponse.body);
  const missingSourceId = missingSourceResponse.json().project.id as string;
  await app.inject({ method: "PATCH", url: `/api/projects/${missingSourceId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: ["IN_PROGRESS", "DONE"], defaultStatus: "IN_PROGRESS" } });
  const missingSourceClaim = await app.inject({ method: "POST", url: `/api/projects/${missingSourceId}/tasks/claim`, headers: { authorization: `Bearer ${jwtToken}` }, payload: {} });
  assert.equal(missingSourceClaim.statusCode, 400, missingSourceClaim.body);
  assert.match(missingSourceClaim.json().error, /requires at least one claim source status \(BACKLOG, TODO\).*project settings/);

  for (const id of [claimProjectId, missingTargetId, missingSourceId]) {
    const removed = await app.inject({ method: "DELETE", url: `/api/projects/${id}`, headers: { authorization: `Bearer ${jwtToken}` } });
    assert.equal(removed.statusCode, 204, removed.body);
  }
});

test("duplicate project keys return a conflict instead of an internal error", async () => {
  const duplicate = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "API", name: "Duplicate project", description: "", color: "#6554C0" } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error, "Project key API is already in use");
});

test("project ordering persists and new projects prepend", async () => {
  const second = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "ORD", name: "Ordered project", description: "", color: "#123456" } });
  assert.equal(second.statusCode, 201);
  const secondId = second.json().project.id as string;
  const reorder = await app.inject({ method: "PATCH", url: "/api/projects/order", headers: { authorization: `Bearer ${jwtToken}` }, payload: { projectIds: [secondId, projectId] } });
  assert.equal(reorder.statusCode, 204, reorder.body);
  const newest = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "NEW", name: "Newest project", description: "", color: "#654321" } });
  assert.equal(newest.statusCode, 201);
  const listed = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` } });
  assert.deepEqual(listed.json().projects.slice(0, 3).map((project: { id: string }) => project.id), [newest.json().project.id, secondId, projectId]);
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
  assert.deepEqual(created.json().task.phase, { id: phaseId, projectId, number: 2, goal: "Deliver the integration", isActive: true, createdAt: created.json().task.phase.createdAt, updatedAt: created.json().task.phase.updatedAt });
  assert.deepEqual(created.json().task.tags.map((tag: { name: string }) => tag.name), ["backend", "frontend"]);
  taskId = created.json().task.id;

  const avatar = await app.inject({ method: "POST", url: `/api/users/${agentId}/avatar`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" } });
  assert.equal(avatar.statusCode, 200, avatar.body);
  assert.match(avatar.json().user.avatarUrl, /^data:image\/png;base64,/);
  const avatarTask = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(avatarTask.json().task.assignee.avatarUrl, avatar.json().user.avatarUrl);

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
  assert.equal(updated.json().task.dependencies[0].projectKey, "API");
  assert.equal(updated.json().task.dependencies[0].isBlocking, true);
  assert.ok(updated.json().task.statusDurations.TODO !== undefined);
  assert.ok(updated.json().task.statusDurations.IN_PROGRESS !== undefined);
  assert.equal(updated.json().task.statusDurations.DONE, undefined);
  assert.equal(updated.json().task.statusDurations.CANCELLED, undefined);

  const postedDependencies = await app.inject({
    method: "POST", url: `/api/tasks/${taskId}/dependencies`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { dependencyIds: [blockerId] },
  });
  assert.equal(postedDependencies.statusCode, 200, postedDependencies.body);
  assert.deepEqual(postedDependencies.json().task.dependencies.map((dependency: { dependsOnTaskId: string }) => dependency.dependsOnTaskId), [blockerId]);

  const invalidDependencyPayload = await app.inject({
    method: "POST", url: `/api/tasks/${taskId}/dependencies`, headers: { authorization: `Bearer ${jwtToken}` },
    payload: { dependencyIds: ["not-a-uuid"] },
  });
  assert.equal(invalidDependencyPayload.statusCode, 400);

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

test("administrators manage signed webhook secrets and durable deliveries", async () => {
  const memberLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.com", password: "password123" } });
  assert.equal(memberLogin.statusCode, 200, memberLogin.body);
  const memberToken = memberLogin.json().token as string;

  const forbiddenConfig = await app.inject({ method: "PATCH", url: `/api/users/${agentId}/webhook`, headers: { authorization: `Bearer ${memberToken}` }, payload: { webhookUrl: "https://agent.example/webhook" } });
  assert.equal(forbiddenConfig.statusCode, 403, forbiddenConfig.body);
  const credentialUrl = await app.inject({ method: "PATCH", url: `/api/users/${agentId}/webhook`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { webhookUrl: "https://user:password@agent.example/webhook" } });
  assert.equal(credentialUrl.statusCode, 400, credentialUrl.body);

  const configured = await app.inject({ method: "PATCH", url: `/api/users/${agentId}/webhook`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { webhookUrl: "https://agent.example/webhook" } });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.match(configured.json().webhookSecret, /^whsec_/);
  assert.equal(configured.json().user.webhookSecretConfigured, true);
  const firstSecret = configured.json().webhookSecret as string;

  const savedAgain = await app.inject({ method: "PATCH", url: `/api/users/${agentId}/webhook`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { webhookUrl: "https://agent.example/updated" } });
  assert.equal(savedAgain.statusCode, 200, savedAgain.body);
  assert.equal(savedAgain.json().webhookSecret, undefined, "an existing signing secret must not be revealed again");

  const rotated = await app.inject({ method: "POST", url: `/api/users/${agentId}/webhook-secret/rotate`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.match(rotated.json().webhookSecret, /^whsec_/);
  assert.notEqual(rotated.json().webhookSecret, firstSecret);

  const webhookTask = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Webhook outbox coverage", assigneeId: agentId, status: "TODO" } });
  assert.equal(webhookTask.statusCode, 201, webhookTask.body);
  const webhookTaskId = webhookTask.json().task.id as string;
  const update = await app.inject({ method: "POST", url: `/api/tasks/${webhookTaskId}/updates`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { body: "Please process this update." } });
  assert.equal(update.statusCode, 201, update.body);

  const rows = await db.prepare("SELECT id, event_type, payload, status FROM webhook_deliveries WHERE task_id = ? ORDER BY created_at").all(webhookTaskId);
  assert.deepEqual(rows.map((row) => row.event_type), ["task.assigned", "task.update_added"]);
  assert.ok(rows.every((row) => row.status === "PENDING"));
  for (const row of rows) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    assert.equal(payload.id, row.id, "the persisted event ID is also the receiver idempotency key");
  }

  const listed = await app.inject({ method: "GET", url: `/api/users/webhook-deliveries?agentId=${agentId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().deliveries.length, 2);
  assert.equal("payload" in listed.json().deliveries[0], false, "operators must not receive stored payload credentials");
  assert.equal((await app.inject({ method: "GET", url: "/api/users/webhook-deliveries", headers: { authorization: `Bearer ${memberToken}` } })).statusCode, 403);

  const failedId = String(rows[0]!.id);
  await db.prepare("UPDATE webhook_deliveries SET status = 'FAILED', attempt_count = 5, failed_at = ?, last_error = 'HTTP 503' WHERE id = ?").run(new Date().toISOString(), failedId);
  const retried = await app.inject({ method: "POST", url: `/api/users/webhook-deliveries/${failedId}/retry`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(retried.json().delivery.status, "RETRYING");
  assert.equal(retried.json().delivery.attemptCount, 0);
  assert.equal((await app.inject({ method: "POST", url: `/api/users/webhook-deliveries/${failedId}/retry`, headers: { authorization: `Bearer ${jwtToken}` } })).statusCode, 400);
  await db.prepare("DELETE FROM notifications WHERE user_id = ? AND task_id = ?").run(agentId, webhookTaskId);
});

test("reporting endpoints preserve access, dashboard, and agent operations behavior", async () => {
  const memberLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.com", password: "password123" } });
  assert.equal(memberLogin.statusCode, 200, memberLogin.body);
  const memberToken = memberLogin.json().token as string;
  const addedMember = await app.inject({ method: "POST", url: `/api/projects/${projectId}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId: memberId, role: "MEMBER" } });
  assert.equal(addedMember.statusCode, 204, addedMember.body);

  const myTask = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Admin dashboard task", assigneeId: adminId, status: "TODO" } });
  assert.equal(myTask.statusCode, 201, myTask.body);
  const staleAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  await db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(staleAt, taskId);

  const dashboard = await app.inject({ method: "GET", url: "/api/dashboard/summary", headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(dashboard.statusCode, 200, dashboard.body);
  const projectSummary = dashboard.json().projects.find((project: { id: string }) => project.id === projectId);
  assert.ok(projectSummary);
  assert.ok(projectSummary.counts.total >= 4);
  assert.equal(projectSummary.cancelledTaskCount, projectSummary.counts.CANCELLED);
  assert.equal(projectSummary.nonDoneTaskCount, projectSummary.counts.total - projectSummary.counts.DONE - projectSummary.counts.CANCELLED);
  assert.ok(dashboard.json().myTasks.some((task: { id: string }) => task.id === myTask.json().task.id));
  assert.ok(dashboard.json().stuckTasks.some((task: { id: string }) => task.id === taskId));

  const agentOps = await app.inject({ method: "GET", url: "/api/users/agents/ops", headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(agentOps.statusCode, 200, agentOps.body);
  const agent = agentOps.json().agents.find((entry: { id: string }) => entry.id === agentId);
  assert.ok(agent);
  assert.ok(agent.inProgressTasks.some((task: { id: string; isStuck: boolean }) => task.id === taskId && task.isStuck));
  assert.equal(agent.stuckTaskCount, 1);

  const scopedActivity = await app.inject({ method: "GET", url: `/api/activity?projectId=${projectId}&limit=not-a-number`, headers: { authorization: `Bearer ${memberToken}` } });
  assert.equal(scopedActivity.statusCode, 200, scopedActivity.body);
  assert.ok(scopedActivity.json().activity.length > 0);
  assert.ok(scopedActivity.json().activity.every((event: { projectId: string }) => event.projectId === projectId));
  const taskActivity = await app.inject({ method: "GET", url: `/api/activity?taskId=${taskId}`, headers: { authorization: `Bearer ${memberToken}` } });
  assert.equal(taskActivity.statusCode, 200, taskActivity.body);
  assert.ok(taskActivity.json().activity.every((event: { taskId: string }) => event.taskId === taskId));
  assert.equal((await app.inject({ method: "GET", url: "/api/activity", headers: { authorization: `Bearer ${memberToken}` } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/users/agents/ops", headers: { authorization: `Bearer ${memberToken}` } })).statusCode, 403);
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

test("bounded pages are stable and exclude inaccessible records before pagination", async () => {
  const pageProjectResponse = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "PGN", name: "Pagination project", description: "Cursor coverage", color: "#0052CC" } });
  assert.equal(pageProjectResponse.statusCode, 201, pageProjectResponse.body);
  const pageProjectId = pageProjectResponse.json().project.id as string;
  const memberLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.com", password: "password123" } });
  const memberToken = memberLogin.json().token as string;
  await app.inject({ method: "POST", url: `/api/projects/${pageProjectId}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId: memberId, role: "MEMBER" } });

  const timestamp = "2099-01-01T00:00:00.000Z";
  const taskIds = Array.from({ length: 5 }, () => randomUUID());
  for (const [position, id] of taskIds.entries()) {
    await db.prepare("INSERT INTO tasks (id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id, parent_id, branch, due_date, estimate_points, phase_id, pull_request_url, pull_request_title, pull_request_state, position, created_at, updated_at) VALUES (?, ?, ?, ?, '', '', 'TODO', 'MEDIUM', 'FEATURE', NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)").run(id, pageProjectId, position + 1, `Pagination fixture ${position}`, adminId, position, timestamp, timestamp);
  }

  const collect = async (baseUrl: string, field: string, token = memberToken) => {
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    do {
      const separator = baseUrl.includes("?") ? "&" : "?";
      const response = await app.inject({ method: "GET", url: `${baseUrl}${separator}limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.page.limit, 2);
      items.push(...body[field]);
      cursor = body.page.nextCursor;
      assert.equal(body.page.hasMore, Boolean(cursor));
    } while (cursor);
    return items;
  };

  const tasks = await collect(`/api/projects/${pageProjectId}/tasks?q=Pagination%20fixture`, "tasks");
  assert.deepEqual(tasks.map((task) => task.position), [0, 1, 2, 3, 4]);
  assert.equal(new Set(tasks.map((task) => task.id)).size, 5);

  const expectedSearchIds = [...taskIds].sort();
  const search = await collect("/api/search?q=Pagination%20fixture", "results");
  assert.deepEqual(search.map((task) => task.id), expectedSearchIds);

  const updateIds = Array.from({ length: 3 }, () => randomUUID()).sort();
  for (const [index, id] of updateIds.entries()) await db.prepare("INSERT INTO task_updates (id, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, taskIds[0], adminId, `Page note ${index}`, timestamp, timestamp);
  const updates = await collect(`/api/tasks/${taskIds[0]}/updates`, "updates");
  assert.deepEqual(updates.map((update) => update.id), updateIds);
  assert.ok(updates.every((update) => (update.author as { id: string }).id === adminId));

  const notificationIds = Array.from({ length: 3 }, () => randomUUID()).sort();
  for (const id of notificationIds) await db.prepare("INSERT INTO notifications (id, user_id, project_id, task_id, type, title, message, created_at) VALUES (?, ?, ?, ?, 'TEST', 'Page notification', '', ?)").run(id, adminId, pageProjectId, taskIds[0], timestamp);
  const firstNotifications = await app.inject({ method: "GET", url: "/api/notifications?limit=2", headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(firstNotifications.statusCode, 200, firstNotifications.body);
  assert.deepEqual(firstNotifications.json().notifications.map((notification: { id: string }) => notification.id), notificationIds.slice(0, 2));
  assert.ok(firstNotifications.json().unreadCount >= 3, "unread count covers more than the current page");

  const activityIds = Array.from({ length: 3 }, () => randomUUID()).sort();
  for (const id of activityIds) await db.prepare("INSERT INTO activity (id, project_id, task_id, actor_id, action, metadata, created_at) VALUES (?, ?, ?, ?, 'pagination.test', '{}', ?)").run(id, pageProjectId, taskIds[0], adminId, timestamp);
  const activity = await collect(`/api/activity?projectId=${pageProjectId}`, "activity");
  assert.deepEqual(activity.map((event) => event.id), activityIds);

  const privateProject = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "PRV", name: "Private pagination", description: "", color: "#FF5630" } });
  const privateProjectId = privateProject.json().project.id as string;
  const privateTask = await app.inject({ method: "POST", url: `/api/projects/${privateProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Pagination fixture private" } });
  assert.equal((await app.inject({ method: "GET", url: `/api/projects/${privateProjectId}/tasks?limit=1`, headers: { authorization: `Bearer ${memberToken}` } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/api/tasks/${privateTask.json().task.id}/updates?limit=1`, headers: { authorization: `Bearer ${memberToken}` } })).statusCode, 403);
  const accessibleSearch = await collect("/api/search?q=Pagination%20fixture", "results");
  assert.ok(accessibleSearch.every((task) => task.projectId === pageProjectId));

  for (const id of [privateProjectId, pageProjectId]) await app.inject({ method: "DELETE", url: `/api/projects/${id}`, headers: { authorization: `Bearer ${jwtToken}` } });
});

test("an issued agent token authenticates and is scoped by membership", async () => {
  const issued = await app.inject({
    method: "POST", url: `/api/users/${agentId}/tokens`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "CI token", expiresInDays: 30 },
  });
  assert.equal(issued.statusCode, 201);
  assert.match(issued.json().token, /^tf_/);
  agentToken = issued.json().token;

  const listed = await app.inject({ method: "GET", url: `/api/users/${agentId}/tokens`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().tokens[0].revealable, true);
  const tokenId = listed.json().tokens[0].id as string;

  const revealed = await app.inject({ method: "POST", url: `/api/users/${agentId}/tokens/${tokenId}/reveal`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(revealed.statusCode, 200, revealed.body);
  assert.equal(revealed.json().token, agentToken);

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
  assert.equal(context.json().task.phase.id, phaseId);
  assert.equal(context.json().task.phase.number, 2);
  assert.equal(context.json().task.phase.goal, "Deliver the integration");
  assert.equal(context.json().task.updates.length, 1);
  assert.equal(context.json().task.updates[0].body, "Implementation is complete and the PR is ready for review.");
  assert.equal(context.json().task.updates[0].author.id, agentId);
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

test("task attachments persist, download, and appear in task responses", async () => {
  const uploaded = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/attachments`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { fileName: "notes.txt", mimeType: "text/plain", data: Buffer.from("attachment content").toString("base64") } });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const attachment = uploaded.json().attachment;
  assert.equal(attachment.fileName, "notes.txt");
  assert.equal(attachment.size, 18);
  const task = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(task.statusCode, 200);
  assert.equal(task.json().task.attachments[0].id, attachment.id);
  const listed = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/attachments`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().attachments.length, 1);
  const download = await app.inject({ method: "GET", url: `/api/attachments/${attachment.id}/download`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "attachment content");
  const removed = await app.inject({ method: "DELETE", url: `/api/attachments/${attachment.id}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(removed.statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: `/api/tasks/${taskId}/attachments`, headers: { authorization: `Bearer ${jwtToken}` } })).json().attachments.length, 0);
});

test("automations can assign the actor and merge open pull requests", async () => {
  const assignRule = await app.inject({ method: "POST", url: `/api/projects/${projectId}/automations`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "Assign actioner", conditions: [{ field: "status", operator: "changed_to", value: "IN_PROGRESS" }, { field: "assigneeId", operator: "is_empty", value: null }], actions: [{ field: "assigneeId", valueType: "actor", value: null }] } });
  assert.equal(assignRule.statusCode, 201, assignRule.body);
  const task = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Automation assignment", status: "TODO" } });
  const assigned = await app.inject({ method: "PATCH", url: `/api/tasks/${task.json().task.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { status: "IN_PROGRESS" } });
  assert.equal(assigned.statusCode, 200); assert.equal(assigned.json().task.assigneeId, adminId);
  const mergeRule = await app.inject({ method: "POST", url: `/api/projects/${projectId}/automations`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "Merge done PR", conditions: [{ field: "status", operator: "changed_to", value: "DONE" }, { field: "pullRequestState", operator: "equals", value: "OPEN" }], actions: [{ field: "pullRequestState", valueType: "static", value: "MERGED" }] } });
  assert.equal(mergeRule.statusCode, 201, mergeRule.body);
  const prTask = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Automation merge", status: "TODO", pullRequestState: "OPEN" } });
  const merged = await app.inject({ method: "PATCH", url: `/api/tasks/${prTask.json().task.id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { status: "DONE" } });
  assert.equal(merged.statusCode, 200); assert.equal(merged.json().task.pullRequestState, "MERGED");
  const rules = await app.inject({ method: "GET", url: `/api/projects/${projectId}/automations`, headers: { authorization: `Bearer ${jwtToken}` } }); assert.equal(rules.json().automations.length, 2);
});

test("configured autonomous workflow routes implementation, review, fix, and re-review ownership", async () => {
  const reviewerId = randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)")
    .run(reviewerId, `reviewer-${reviewerId}@example.com`, "Review Agent", now);
  const created = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: `LOOP${randomUUID().slice(0, 4)}`, name: "Autonomous loop", description: "End-to-end workflow routing", color: "#0052CC" } });
  assert.equal(created.statusCode, 201, created.body);
  const loopProjectId = created.json().project.id as string;
  for (const userId of [agentId, reviewerId]) {
    const membership = await app.inject({ method: "POST", url: `/api/projects/${loopProjectId}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId, role: "MEMBER" } });
    assert.equal(membership.statusCode, 204, membership.body);
  }
  const workflowStatuses = ["TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "APPROVED", "FIX_NEEDED", "FIX_IN_PROGRESS", "RE_REVIEW"];
  const configured = await app.inject({ method: "PATCH", url: `/api/projects/${loopProjectId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { availableStatuses: workflowStatuses, defaultStatus: "TODO", agentWorkflow: { implementationQueue: "TODO", implementationStart: "IN_PROGRESS", reviewHandoff: "READY_FOR_REVIEW", reviewStart: "IN_REVIEW", approved: "APPROVED", fixNeeded: "FIX_NEEDED", fixStart: "FIX_IN_PROGRESS", reReview: "RE_REVIEW" } } });
  assert.equal(configured.statusCode, 200, configured.body);
  const reviewerWebhook = await app.inject({ method: "PATCH", url: `/api/users/${reviewerId}/webhook`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { webhookUrl: "http://127.0.0.1:4500/agents/reviewer" } });
  assert.equal(reviewerWebhook.statusCode, 200, reviewerWebhook.body);
  const rule = async (name: string, status: string, assignee: string) => {
    const response = await app.inject({ method: "POST", url: `/api/projects/${loopProjectId}/automations`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name, conditions: [{ field: "status", operator: "changed_to", value: status }], actions: [{ field: "assigneeId", valueType: "user", value: assignee }] } });
    assert.equal(response.statusCode, 201, response.body);
  };
  await rule("Route review", "READY_FOR_REVIEW", reviewerId);
  await rule("Route fixes", "FIX_NEEDED", agentId);
  await rule("Route re-review", "RE_REVIEW", reviewerId);
  const createdTask = await app.inject({ method: "POST", url: `/api/projects/${loopProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Autonomous loop task", status: "TODO", assigneeId: agentId, branch: "agent/autonomous-loop" } });
  assert.equal(createdTask.statusCode, 201, createdTask.body);
  const loopTaskId = createdTask.json().task.id as string;
  const runResponse = await app.inject({ method: "POST", url: `/api/tasks/${loopTaskId}/runs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { kind: "IMPLEMENTATION" } });
  assert.equal(runResponse.statusCode, 201, runResponse.body);
  const runId = runResponse.json().run.id as string;
  const claimedRun = await app.inject({ method: "POST", url: `/api/runs/${runId}/claim`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { leaseMs: 60_000 } });
  assert.equal(claimedRun.statusCode, 200, claimedRun.body);
  const move = async (status: string, assignee: string) => {
    const response = await app.inject({ method: "PATCH", url: `/api/tasks/${loopTaskId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { status, runId } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().task.status, status);
    assert.equal(response.json().task.assigneeId, assignee);
  };
  await move("IN_PROGRESS", agentId);
  await move("READY_FOR_REVIEW", reviewerId);
  await move("IN_REVIEW", reviewerId);
  await move("FIX_NEEDED", agentId);
  await move("FIX_IN_PROGRESS", agentId);
  await move("RE_REVIEW", reviewerId);
  await move("APPROVED", reviewerId);
  const deliveries = await db.prepare("SELECT event_type, agent_id, payload FROM webhook_deliveries WHERE task_id = ? ORDER BY created_at ASC").all(loopTaskId) as Array<{ event_type: string; agent_id: string; payload: string | object }>;
  assert.ok(deliveries.some((delivery) => delivery.event_type === "task.status_changed" && delivery.agent_id === reviewerId));
  assert.ok(deliveries.some((delivery) => (typeof delivery.payload === "string" ? JSON.parse(delivery.payload) : delivery.payload as { runId?: string }).runId === runId));
  const evidence = await app.inject({ method: "PUT", url: `/api/tasks/${loopTaskId}/gate`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", requiredChecks: ["Quality"], checks: [{ name: "Quality", status: "PASS", headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] } });
  assert.equal(evidence.statusCode, 200, evidence.body);
  const scoped = await app.inject({ method: "POST", url: `/api/users/${reviewerId}/tokens`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { name: "Gate reviewer", permissions: ["task:gate:approve"] } });
  assert.equal(scoped.statusCode, 201, scoped.body);
  const scopedToken = scoped.json().token as string;
  const agentMerge = await app.inject({ method: "POST", url: `/api/tasks/${loopTaskId}/gate/merge`, headers: { authorization: `Bearer ${scopedToken}` }, payload: { headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  assert.equal(agentMerge.statusCode, 403, agentMerge.body);
  const approval = await app.inject({ method: "POST", url: `/api/tasks/${loopTaskId}/gate/approve`, headers: { authorization: `Bearer ${scopedToken}` }, payload: { headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  assert.equal(approval.statusCode, 200, approval.body);
  const merge = await app.inject({ method: "POST", url: `/api/tasks/${loopTaskId}/gate/merge`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  assert.equal(merge.statusCode, 200, merge.body);
  const completedRun = await app.inject({ method: "POST", url: `/api/runs/${runId}/complete`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { status: "SUCCEEDED" } });
  assert.equal(completedRun.statusCode, 200, completedRun.body);
  const deleted = await app.inject({ method: "DELETE", url: `/api/projects/${loopProjectId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(deleted.statusCode, 204, deleted.body);
});

test("task types default to FEATURE and are settable, filterable, and validated", async () => {
  const project = await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${jwtToken}` }, payload: { key: "TYP", name: "Task types", description: "Task type coverage", color: "#0747A6" } });
  assert.equal(project.statusCode, 201, project.body);
  const typeProjectId = project.json().project.id as string;

  const defaulted = await app.inject({ method: "POST", url: `/api/projects/${typeProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Type is optional" } });
  assert.equal(defaulted.statusCode, 201, defaulted.body);
  assert.equal(defaulted.json().task.type, "FEATURE");
  const defaultedId = defaulted.json().task.id as string;

  const bug = await app.inject({ method: "POST", url: `/api/projects/${typeProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Crash while saving", type: "BUG" } });
  assert.equal(bug.statusCode, 201, bug.body);
  assert.equal(bug.json().task.type, "BUG");

  const patched = await app.inject({ method: "PATCH", url: `/api/tasks/${defaultedId}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { type: "SECURITY" } });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json().task.type, "SECURITY");
  const reread = await app.inject({ method: "GET", url: `/api/tasks/${defaultedId}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(reread.json().task.type, "SECURITY");

  const filtered = await app.inject({ method: "GET", url: `/api/projects/${typeProjectId}/tasks?type=BUG`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(filtered.json().tasks.map((task: { title: string }) => task.title), ["Crash while saving"]);

  const invalidBody = await app.inject({ method: "POST", url: `/api/projects/${typeProjectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Lowercase type", type: "feature" } });
  assert.equal(invalidBody.statusCode, 400);
  assert.deepEqual(invalidBody.json().issues[0].options, ["FEATURE", "BUG", "INFRA", "UPDATE", "SECURITY", "DOCS", "CHORE"]);

  const invalidFilter = await app.inject({ method: "GET", url: `/api/projects/${typeProjectId}/tasks?type=EPIC`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(invalidFilter.statusCode, 400, invalidFilter.body);
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

test("login throttles by account and records redacted audit metadata", async () => {
  const account = `unknown-${randomUUID()}@example.com`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": "198.51.100.10" }, payload: { email: account, password: "not-the-password" } });
    assert.equal(response.statusCode, 401);
  }
  const throttled = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": "198.51.100.10" }, payload: { email: account, password: "not-the-password" } });
  assert.equal(throttled.statusCode, 429);
  const audit = await db.prepare("SELECT outcome, ip_address, account FROM security_audit_events WHERE account = ? AND outcome = 'throttled' ORDER BY created_at DESC LIMIT 1").get(account) as { outcome: string; ip_address: string; account: string };
  assert.equal(audit.outcome, "throttled");
  assert.equal(audit.ip_address, "127.0.0.1");
  assert.equal(audit.account, account);
  assert.doesNotMatch(JSON.stringify(audit), /not-the-password/);
});

test("agent logs are paginated, ordered, redacted, and idempotent", async () => {
  const first = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/agent-logs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { provider: "codex", stream: "stdout", category: "output", sequence: 1, eventId: "api-log-event-1", content: "first password=secret-one" } });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().agentLog.content, "first password=[REDACTED]");
  const duplicate = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/agent-logs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { provider: "codex", stream: "stdout", category: "output", sequence: 1, eventId: "api-log-event-1", content: "duplicate" } });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().duplicate, true);
  for (const sequence of [2, 3]) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/agent-logs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { provider: "codex", stream: "stdout", category: "output", sequence, eventId: `api-log-event-${sequence}`, content: `log-${sequence}` } });
    assert.equal(response.statusCode, 201);
  }
  const page = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/agent-logs?limit=2`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(page.json().agentLogs.map((log: { sequence: number }) => log.sequence), [3, 2]);
  assert.equal(page.json().page.hasMore, true);
  const next = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/agent-logs?limit=2&cursor=${encodeURIComponent(page.json().page.nextCursor)}`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.deepEqual(next.json().agentLogs.map((log: { sequence: number }) => log.sequence), [1]);
});

test("agent observability API exposes run health fields alongside logs", async () => {
  const timeoutAt = new Date(Date.now() + 120_000).toISOString();
  const created = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/runs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { kind: "IMPLEMENTATION", timeoutAt } });
  assert.equal(created.statusCode, 201, created.body);
  const run = created.json().run as { id: string; status: string; heartbeatAt: string | null; leaseExpiresAt: string | null; timeoutAt: string | null };
  assert.equal(run.status, "PENDING");
  assert.equal(run.heartbeatAt, null);
  assert.equal(run.leaseExpiresAt, null);
  assert.equal(run.timeoutAt, timeoutAt);
  const listed = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/runs`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(listed.statusCode, 200);
  assert.ok(listed.json().runs.some((candidate: { id: string }) => candidate.id === run.id));
  const logs = await app.inject({ method: "GET", url: `/api/tasks/${taskId}/agent-logs?limit=1`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(logs.statusCode, 200);
  assert.equal(typeof logs.json().page.hasMore, "boolean");
});

test("handoff checkpoints survive repeated API access and gate agent review readiness", async () => {
  const membership = await app.inject({ method: "POST", url: `/api/projects/${projectId}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId: agentId, role: "MEMBER" } });
  assert.ok([204, 409].includes(membership.statusCode), membership.body);
  const created = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { title: "Handoff persistence", status: "TODO", assigneeId: agentId, branch: "agent/handoff" } });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().task.id as string;
  const runResponse = await app.inject({ method: "POST", url: `/api/tasks/${id}/runs`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { kind: "IMPLEMENTATION" } });
  const runId = runResponse.json().run.id as string;
  const incomplete = await app.inject({ method: "PUT", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { branch: "agent/handoff", headSha: null, branchPublished: false, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, status: "PENDING", lastError: "Authorization: Bearer tf_example" } });
  assert.equal(incomplete.statusCode, 200, incomplete.body);
  assert.match(incomplete.json().handoff.lastError, /REDACTED/);
  const reopened = await app.inject({ method: "GET", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(reopened.json().handoff.status, "PENDING");
  const blocked = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, headers: { authorization: `Bearer ${agentToken}` }, payload: { status: "READY_FOR_REVIEW", runId } });
  assert.equal(blocked.statusCode, 400);
  const missingPr = await app.inject({ method: "PUT", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { branch: "agent/handoff", headSha: "a".repeat(40), branchPublished: true, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, status: "PUBLISHED" } });
  assert.equal(missingPr.statusCode, 400);
  assert.match(missingPr.json().error, /Published handoff requires branch, head SHA, published branch, and pull request metadata/);
  const published = await app.inject({ method: "PUT", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { branch: "agent/handoff", headSha: "a".repeat(40), branchPublished: true, pullRequestUrl: "https://github.com/example/repo/pull/1", pullRequestTitle: "Handoff", pullRequestState: "OPEN", status: "PUBLISHED" } });
  assert.equal(published.statusCode, 200, published.body);
  const duplicatePublished = await app.inject({ method: "PUT", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { branch: "agent/handoff", headSha: "a".repeat(40), branchPublished: true, pullRequestUrl: "https://github.com/example/repo/pull/1", pullRequestTitle: "Handoff", pullRequestState: "OPEN", status: "PUBLISHED" } });
  assert.equal(duplicatePublished.statusCode, 200, duplicatePublished.body);
  assert.deepEqual(
    { ...duplicatePublished.json().handoff, updatedAt: undefined },
    { ...published.json().handoff, updatedAt: undefined },
  );
  const reassigneeId = randomUUID();
  await db.prepare("INSERT INTO users (id, email, name, kind, role, created_at) VALUES (?, ?, ?, 'AGENT', 'MEMBER', ?)").run(reassigneeId, `reassignee-${reassigneeId}@example.com`, "Reassigned Agent", new Date().toISOString());
  const reassignmentMembership = await app.inject({ method: "POST", url: `/api/projects/${projectId}/members`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { userId: reassigneeId, role: "MEMBER" } });
  assert.ok([204, 409].includes(reassignmentMembership.statusCode), reassignmentMembership.body);
  const reassigned = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, headers: { authorization: `Bearer ${jwtToken}` }, payload: { assigneeId: reassigneeId } });
  assert.equal(reassigned.statusCode, 200, reassigned.body);
  assert.equal(reassigned.json().task.branch, "agent/handoff");
  const retainedEvidence = await app.inject({ method: "GET", url: `/api/runs/${runId}/handoff`, headers: { authorization: `Bearer ${jwtToken}` } });
  assert.equal(retainedEvidence.json().handoff.headSha, "a".repeat(40));
  const ready = await app.inject({ method: "PATCH", url: `/api/tasks/${id}`, headers: { authorization: `Bearer ${agentToken}` }, payload: { status: "READY_FOR_REVIEW", runId } });
  assert.equal(ready.statusCode, 200, ready.body);
});
