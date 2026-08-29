import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityApplicationService, ConflictError, DashboardApplicationService, ForbiddenError, NotFoundError, PhaseApplicationService, UserApplicationService, ValidationError, type PhaseEntity, type ProjectEntity, type RepositorySet, type RequestContext, type TaskEntity, type UnitOfWork, type UserEntity } from "../src/application/index.js";

const adminContext: RequestContext = { actor: { userId: "admin-1", name: "Admin", kind: "HUMAN", role: "ADMIN", tokenScopes: null } };
const memberContext: RequestContext = { actor: { userId: "member-1", name: "Member", kind: "HUMAN", role: "MEMBER", tokenScopes: null } };
const unitOfWork = (repositories: RepositorySet): UnitOfWork => ({ run: (work) => work(repositories) });
const project = (input: Pick<ProjectEntity, "id" | "key" | "name">): ProjectEntity => ({ ...input, description: "", repoUrl: null, color: "#6554C0", sortOrder: 0, availableStatuses: ["TODO", "IN_PROGRESS", "DONE"], defaultStatus: "TODO", ownerId: "admin-1", createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z" });
const task = (input: Partial<TaskEntity> = {}): TaskEntity => ({ id: "task-1", projectId: "project-1", number: 1, title: "Task", description: "", definitionOfDone: "", status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "admin-1", parentId: null, branch: null, dueDate: null, estimatePoints: null, phaseId: null, pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T07:00:00.000Z", ...input });

test("application errors expose stable transport-independent codes", () => {
  assert.equal(new ConflictError("duplicate key").code, "CONFLICT");
  assert.equal(new ForbiddenError().code, "FORBIDDEN");
  assert.equal(new NotFoundError("Task").code, "NOT_FOUND");
  assert.equal(new ValidationError("invalid input").code, "VALIDATION");
});

test("phase delivery creates a reusable branch and guards the final merge", async () => {
  const phase: PhaseEntity = { id: "phase-1", projectId: "project-1", number: 2, goal: "Ship", isActive: true, branchName: null, createdAt: "now", updatedAt: "now" };
  const projectEntity = { ...project({ id: "project-1", key: "TAS!" }), mergeTarget: "phase" as const };
  let incomplete = true;
  const repositories = {
    projects: { findById: async () => projectEntity },
    phases: { findById: async () => phase, update: async (_id: string, input: Partial<PhaseEntity>) => Object.assign(phase, input) },
    memberships: { isMember: async () => true },
    tasks: { hasIncompleteByPhase: async () => incomplete },
  } as unknown as RepositorySet;
  const service = new PhaseApplicationService(unitOfWork(repositories));
  const context: RequestContext = { actor: { userId: "admin-1", name: "Admin", kind: "HUMAN", role: "ADMIN", tokenScopes: null }, projectId: "project-1" };
  const first = await service.ensureBranch(context, phase.id);
  const second = await service.ensureBranch(context, phase.id);
  assert.equal(first.branchName, "phase/tas--2");
  assert.equal(second.branchName, first.branchName);
  await assert.rejects(() => service.mergeToMain(context, phase.id), ValidationError);
  incomplete = false;
  assert.equal((await service.mergeToMain(context, phase.id)).target, "main");
  const memberRequest = { ...context, actor: memberContext.actor };
  await assert.rejects(() => service.mergeToMain(memberRequest, phase.id), ForbiddenError);
});

test("dashboard service authorizes projects and assembles reporting responses", async () => {
  const projects = [project({ id: "project-b", key: "B", name: "Beta" }), project({ id: "project-a", key: "A", name: "Alpha" })];
  const repositories = {
    projects: { listAccessible: async (actorId: string, isAdmin: boolean) => { assert.equal(actorId, "admin-1"); assert.equal(isAdmin, true); return projects; } },
    reporting: {
      countTasksByProject: async (projectIds: string[]) => { assert.deepEqual(projectIds, ["project-a", "project-b"]); return [{ projectId: "project-a", status: "TODO", count: 2 }]; },
      countNonDonePhasesByProject: async () => [{ projectId: "project-a", nonDonePhaseCount: 1 }],
      listMyOpenTasks: async () => [{ id: "mine", number: 2, title: "Mine", projectId: "project-a", projectKey: "A", projectName: "Alpha", status: "TODO", assigneeId: "admin-1", assigneeName: "Admin", updatedAt: "2026-08-22T10:00:00.000Z" }],
      listStuckTasks: async (_projectIds: string[], updatedBefore: string) => { assert.equal(updatedBefore, "2026-08-22T08:00:00.000Z"); return [{ id: "stuck", number: 3, title: "Stuck", projectId: "project-b", projectKey: "B", projectName: "Beta", status: "IN_PROGRESS", assigneeId: "agent-1", assigneeName: "Agent", updatedAt: "2026-08-22T07:00:00.000Z" }]; },
    },
  } as unknown as RepositorySet;
  const summary = await new DashboardApplicationService(unitOfWork(repositories), () => "2026-08-22T12:00:00.000Z").summary(adminContext);
  assert.deepEqual(summary.projects.map(({ name }) => name), ["Alpha", "Beta"]);
  assert.equal(summary.projects[0]?.counts.TODO, 2);
  assert.equal(summary.projects[0]?.counts.total, 2);
  assert.equal(summary.projects[0]?.nonDoneTaskCount, 2);
  assert.equal(summary.projects[0]?.cancelledTaskCount, 0);
  assert.equal(summary.projects[0]?.nonDonePhaseCount, 1);
  assert.equal(summary.myTasks[0]?.id, "mine");
  assert.equal(summary.stuckTasks[0]?.id, "stuck");
});

test("activity service owns project and task access decisions", async () => {
  let isMember = true;
  const repositories = {
    tasks: { findById: async () => task() },
    memberships: { isMember: async () => isMember },
    activity: { list: async (filters: { page: { limit: number } }) => { assert.equal(filters.page.limit, 20); return { items: [{ id: "activity-1" }], page: { limit: 20, hasMore: false, nextCursor: null } }; } },
  } as unknown as RepositorySet;
  const service = new ActivityApplicationService(unitOfWork(repositories));
  assert.equal((await service.list(memberContext, { taskId: "task-1", page: { limit: 20 } })).items[0]?.id, "activity-1");
  isMember = false;
  await assert.rejects(() => service.list(memberContext, { projectId: "project-1", page: { limit: 20 } }), ForbiddenError);
  await assert.rejects(() => service.list(memberContext, { page: { limit: 20 } }), /Provide a projectId or taskId/);
});

test("user service assembles agent operations and enforces admin access", async () => {
  const agent: UserEntity = { id: "agent-1", email: "agent@example.com", name: "Agent", kind: "AGENT", role: "MEMBER", avatarUrl: null, webhookUrl: "https://agent.example/webhook", createdAt: "2026-08-22T00:00:00.000Z" };
  const repositories = {
    users: { list: async () => [agent] },
    reporting: {
      listAgentInProgressTasks: async () => [{ id: "task-1", number: 1, title: "Agent task", projectId: "project-1", projectKey: "TAS", projectName: "Task Forge", status: "IN_PROGRESS", assigneeId: "agent-1", assigneeName: "Agent", updatedAt: "2026-08-22T07:00:00.000Z" }],
      listAgentLastActive: async () => [{ agentId: "agent-1", lastActiveAt: "2026-08-22T11:00:00.000Z" }],
    },
  } as unknown as RepositorySet;
  const service = new UserApplicationService(unitOfWork(repositories), () => "2026-08-22T12:00:00.000Z");
  const operations = await service.agentOperations(adminContext);
  assert.equal(operations[0]?.lastActiveAt, "2026-08-22T11:00:00.000Z");
  assert.equal(operations[0]?.openTaskCount, 1);
  assert.equal(operations[0]?.stuckTaskCount, 1);
  assert.equal(operations[0]?.inProgressTasks[0]?.isStuck, true);
  await assert.rejects(() => service.agentOperations(memberContext), ForbiddenError);
});
