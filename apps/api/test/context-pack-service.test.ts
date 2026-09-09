import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentContextPackApplicationService, persistInitialContextPack } from "../src/application/context-pack-service.js";
import type { AgentContextPackEntity, AgentRunEntity, ProjectEntity, TaskEntity } from "../src/application/models.js";
import type { RepositorySet } from "../src/application/repositories.js";

const now = "2026-09-09T08:00:00.000Z";
const project: ProjectEntity = {
  id: "project-1", key: "TAS", name: "Task Forge", description: "", repoUrl: "https://user:password@github.com/acme/task-forge.git?token=hidden", localRepoPath: "/private/worktree",
  color: "#6554C0", sortOrder: 0, availableStatuses: ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"], defaultStatus: "TODO", agentWorkflow: null,
  hiddenEmptyStatuses: [], mergeTarget: "main", dependencyResolutionStatuses: ["DONE", "CANCELLED"], reviewPolicy: { requireIndependentReview: true, requiredReviewerCount: 1, allowedReviewerAgentIds: [] },
  ownerId: "owner-1", createdAt: now, updatedAt: now,
};
const task: TaskEntity = {
  id: "task-1", projectId: project.id, number: 115, title: "Context token=tf_title_secret", description: "Use api_key=description-secret", definitionOfDone: "No password=hunter2",
  status: "IN_PROGRESS", priority: "MEDIUM", type: "FEATURE", assigneeId: "agent-1", creatorId: "owner-1", parentId: null, branch: "agent/context", dueDate: null,
  estimatePoints: null, phaseId: "phase-13", pullRequestUrl: null, pullRequestTitle: null, pullRequestState: null, position: 0, createdAt: now, updatedAt: now,
  dependencies: [{ taskId: "task-1", dependsOnTaskId: "task-0", projectId: project.id, projectKey: "TAS", number: 114, title: "Planning", status: "DONE", isBlocking: false }],
  attachments: [{ id: "attachment-1", taskId: "task-1", fileName: "../evidence-token=tf_attachment_secret.txt", mimeType: "text/plain", size: 12, storageKey: "/private/credential-storage", uploadedById: "owner-1", createdAt: now }],
};
const run: AgentRunEntity = {
  id: "run-1", taskId: task.id, projectId: project.id, requestedById: "owner-1", executedById: null, kind: "IMPLEMENTATION", status: "PENDING", controlState: "ACTIVE", controlVersion: 0,
  assignedAgentId: "agent-1", inputRequest: null, inputResponse: null, inputRequestedAt: null, inputAnsweredAt: null, takeoverById: null, attemptCount: 0, maxAttempts: 3,
  leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null, timeoutAt: null, lastError: null, createdAt: now, updatedAt: now, completedAt: null, contextPackVersion: 0, contextPackFingerprint: null,
};

function fixture() {
  const packs: AgentContextPackEntity[] = [];
  const activity: Array<Record<string, any>> = [];
  let reverse = false;
  const updates = [
    ...Array.from({ length: 45 }, (_, index) => ({ id: `routine-${String(index).padStart(2, "0")}`, taskId: task.id, authorId: "owner-1", body: `Routine progress ${index}`, createdAt: `2026-09-08T00:${String(index).padStart(2, "0")}:00.000Z`, updatedAt: now })),
    { id: "decision-1", taskId: task.id, authorId: "owner-1", body: "Decision approved with Authorization: Bearer private-token", createdAt: "2026-09-08T01:00:00.000Z", updatedAt: now },
  ];
  const repositories = {
    projects: { findById: async (id: string) => id === project.id ? project : null },
    memberships: { isMember: async (_projectId: string, userId: string) => userId !== "outsider" },
    tasks: { findById: async (id: string) => id === task.id ? task : null },
    updates: { listForTask: async () => { reverse = !reverse; return { items: reverse ? [...updates].reverse() : updates, page: { hasMore: false, nextCursor: null } }; } },
    findings: { listForTask: async () => [
      { id: "finding-safe", taskId: task.id, runId: null, authorId: "reviewer", severity: "P1", title: "Approved fix", body: "secret=finding-secret", filePath: "src/context.ts", lineNumber: 9, disposition: "ACCEPTED", dispositionById: "owner-1", dispositionReason: "token=decision-secret", decisionOwnerId: null, dueAt: null, createdAt: now, updatedAt: now },
      { id: "finding-unsafe", taskId: task.id, runId: null, authorId: "reviewer", severity: "P2", title: "Unsafe path", body: "Review", filePath: "../private.env", lineNumber: null, disposition: "OPEN", dispositionById: null, dispositionReason: null, decisionOwnerId: null, dueAt: null, createdAt: now, updatedAt: now },
    ] },
    runs: { findById: async (id: string) => id === run.id ? run : null, listForTask: async () => [run] },
    contextPacks: {
      findCurrent: async (runId: string) => packs.filter((pack) => pack.runId === runId).at(-1) ?? null,
      listForRun: async (runId: string) => packs.filter((pack) => pack.runId === runId).slice().reverse(),
      nextVersion: async (runId: string) => packs.filter((pack) => pack.runId === runId).length + 1,
      create: async (pack: AgentContextPackEntity) => { packs.push(pack); run.contextPackVersion = pack.version; run.contextPackFingerprint = pack.fingerprint; return pack; },
    },
    activity: { record: async (entry: Record<string, any>) => { activity.push(entry); } },
  } as unknown as RepositorySet;
  return { repositories, packs, activity };
}

test("context packs are deterministic, redacted, summarized, and explicitly versioned", async () => {
  const { repositories, packs, activity } = fixture();
  let ids = 0;
  const initial = await persistInitialContextPack(repositories, run, "owner-1", now, () => `pack-${++ids}`);
  const repeated = await persistInitialContextPack(repositories, run, "owner-1", now, () => `pack-${++ids}`);
  assert.equal(repeated.id, initial.id, "retrying initial persistence reuses the stored context");
  assert.equal(packs.length, 1);
  assert.equal(initial.version, 1);
  assert.match(initial.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(run.contextPackVersion, 1);
  assert.equal(run.contextPackFingerprint, initial.fingerprint);
  assert.equal(initial.content.history.summary.omittedUpdates, 5);
  assert.match(initial.content.history.decisions[0]?.body ?? "", /Decision approved/);
  assert.equal(initial.content.history.findings.find((finding) => finding.id === "finding-unsafe")?.filePath, null);
  assert.deepEqual(initial.content.repository.relevantFiles, ["src/context.ts"]);
  assert.equal(initial.content.attachments[0]?.fileName.startsWith("evidence-"), true);
  assert.equal(initial.content.project.repositoryUrl, "https://github.com/acme/task-forge.git");
  const serialized = JSON.stringify(initial);
  for (const secret of ["private-token", "description-secret", "hunter2", "attachment_secret", "finding-secret", "decision-secret", "/private/worktree", "/private/credential-storage", "user:password"]) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  run.status = "RUNNING"; run.leaseOwner = "agent-1"; run.controlState = "ACTIVE";
  const service = new AgentContextPackApplicationService({ run: async (work) => work(repositories) }, () => "2026-09-09T08:01:00.000Z", () => `pack-${++ids}`);
  const refreshed = await service.refresh({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "MEMBER", tokenScopes: null } }, run.id, "Refresh after token=refresh-secret");
  assert.equal(refreshed.version, 2);
  assert.equal(refreshed.refreshedFromVersion, 1);
  assert.equal(refreshed.fingerprint, initial.fingerprint, "input ordering does not change the content fingerprint");
  assert.doesNotMatch(JSON.stringify(activity), /refresh-secret/);
  assert.deepEqual((await service.list({ actor: { userId: "owner-1", name: "Owner", kind: "HUMAN", role: "MEMBER", tokenScopes: null } }, run.id)).map((pack) => pack.version), [2, 1]);
});

test("context-pack access enforces project membership and run assignment", async () => {
  const { repositories } = fixture();
  await persistInitialContextPack(repositories, run, "owner-1", now, () => "pack-1");
  const service = new AgentContextPackApplicationService({ run: async (work) => work(repositories) });
  await assert.rejects(() => service.get({ actor: { userId: "outsider", name: "Outsider", kind: "HUMAN", role: "MEMBER", tokenScopes: null } }, run.id), /not a member/);
  await assert.rejects(() => service.get({ actor: { userId: "agent-2", name: "Other agent", kind: "AGENT", role: "ADMIN", tokenScopes: null } }, run.id), /not assigned/);
});

test("context packs retain decisions beyond the first history page", async () => {
  const { repositories } = fixture();
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ id: `recent-${index}`, taskId: task.id, authorId: "owner-1", body: `Routine update ${index}`, createdAt: `2026-09-09T08:${String(index % 60).padStart(2, "0")}:00.000Z`, updatedAt: now }));
  repositories.updates.listForTask = async (_taskId, page) => page.cursor
    ? { items: [{ id: "older-decision", taskId: task.id, authorId: "owner-1", body: "Decision: keep the durable checkpoint", createdAt: "2026-09-01T08:00:00.000Z", updatedAt: now }], page: { hasMore: false, nextCursor: null } }
    : { items: firstPage, page: { hasMore: true, nextCursor: "older-page" } };
  const pack = await persistInitialContextPack(repositories, run, "owner-1", now, () => "pack-paged");
  assert.equal(pack.content.history.summary.totalUpdates, 501);
  assert.equal(pack.content.history.summary.omittedUpdates, 460);
  assert.equal(pack.content.history.decisions[0]?.id, "older-decision");
});
