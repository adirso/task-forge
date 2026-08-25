import assert from "node:assert/strict";
import test from "node:test";
import type { Project, Task } from "@taskforge/contracts";
import { aiProviders, buildAIPrompt, buildTaskContextUrl, suggestedTaskBranch, type AIProvider } from "../src/lib/aiPrompt.js";

const project: Project = {
  id: "project-id",
  key: "TAS",
  name: "Task Forge",
  description: "Agent-ready project management",
  repoUrl: "https://github.com/adirso/task-forge",
  color: "#6554C0",
  sortOrder: 0,
  availableStatuses: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"],
  defaultStatus: "TODO",
  ownerId: "owner-id",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

const task: Task = {
  id: "task-id",
  projectId: project.id,
  number: 3,
  title: "Add Send to AI task action",
  description: "Generate provider-specific prompts.",
  definitionOfDone: "Claude Code, Codex, and Cursor receive tailored prompts.",
  status: "TODO",
  priority: "HIGH",
  type: "FEATURE",
  assigneeId: null,
  creatorId: "owner-id",
  parentId: null,
  branch: null,
  dueDate: null,
  estimatePoints: 8,
  phaseId: "phase-id",
  pullRequestUrl: null,
  pullRequestTitle: null,
  pullRequestState: null,
  position: 0,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  tags: [],
  dependencies: [],
  attachments: [],
};

const providerSignals: Record<AIProvider, string> = {
  "claude-code": "Work through Claude Code from the repository root.",
  codex: "Work through Codex in the shared repository workspace.",
  cursor: "Work through Cursor Agent with the repository opened as the active workspace.",
};

test("exposes the three supported provider choices", () => {
  assert.deepEqual(aiProviders.map((provider) => provider.id), ["claude-code", "codex", "cursor"]);
});

test("builds a complete and tailored prompt for every provider", () => {
  const contextUrl = "http://127.0.0.1:5173/?view=board&project=TAS&task=TAS-3";
  for (const provider of Object.keys(providerSignals) as AIProvider[]) {
    const prompt = buildAIPrompt({ provider, project, task, phaseNumber: 1, contextUrl, apiBaseUrl: "http://127.0.0.1:5173/api" });
    assert.match(prompt, new RegExp(providerSignals[provider].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(prompt, /TAS-3 — Add Send to AI task action/);
    assert.match(prompt, /Phase 1/);
    assert.match(prompt, /Type: FEATURE/);
    assert.match(prompt, /Enabled statuses: TODO, IN_PROGRESS, IN_REVIEW, DONE/);
    assert.match(prompt, /https:\/\/github\.com\/adirso\/task-forge/);
    assert.match(prompt, /agent\/tas-3-add-send-to-ai-task-action/);
    assert.match(prompt, /\/api\/context\?project=TAS&task=TAS-3/);
    assert.match(prompt, /pullRequestUrl/);
    assert.match(prompt, /Never print it, paste it into chat, commit it, or write it to repository files/);
    assert.doesNotMatch(prompt, /taskforge_token|localStorage|gho_[A-Za-z0-9]+/);
  }
});

test("builds distinct implementation and review prompts", () => {
  const input = { provider: "codex" as const, project, task, phaseNumber: 1, contextUrl: "https://taskforge.example/?project=TAS&task=TAS-3", apiBaseUrl: "https://api.taskforge.example/api" };
  const implementation = buildAIPrompt({ ...input, mode: "IMPLEMENT" });
  const review = buildAIPrompt({ ...input, mode: "REVIEW" });
  assert.match(implementation, /Implementation mode:/);
  assert.match(implementation, /Implement the task description and every Definition of done item/);
  assert.match(review, /Review mode:/);
  assert.match(review, /compare it against every Definition of done item/);
  assert.match(review, /code quality, correctness, security, performance/);
  assert.match(review, /optimization opportunities|performance/);
  assert.match(review, /pull request diff and head SHA/);
  assert.doesNotMatch(review, /Implement the task description and every Definition of done item/);
  assert.doesNotMatch(review, /Create or switch to the suggested branch/);
  assert.doesNotMatch(review, /Commit the focused change/);
  assert.doesNotMatch(review, /Move the task to IN_PROGRESS/);
  assert.match(review, /do not commit, push, open, or merge a pull request/);
});

test("builds focused fix and re-review prompts from the review trail", () => {
  const input = { provider: "codex" as const, project: { ...project, availableStatuses: ["IN_PROGRESS", "READY_FOR_REVIEW", "RE_REVIEW", "FIX_NEEDED", "DONE"] }, task: { ...task, branch: "agent/tas-77-fix" }, phaseNumber: 1, contextUrl: "https://taskforge.example/?project=TAS&task=TAS-3", apiBaseUrl: "https://api.taskforge.example/api" };
  const fix = buildAIPrompt({ ...input, mode: "FIX" });
  const rereview = buildAIPrompt({ ...input, mode: "RE_REVIEW" });
  assert.match(fix, /Fix needed mode:/);
  assert.match(fix, /existing branch agent\/tas-77-fix/);
  assert.match(fix, /GET https:\/\/api\.taskforge\.example\/api\/tasks\/task-id\/updates/);
  assert.match(fix, /GET https:\/\/api\.taskforge\.example\/api\/tasks\/task-id\/agent-logs/);
  assert.match(fix, /Resolve and test every finding individually/);
  assert.match(fix, /commit and push fixes to the existing branch/);
  assert.doesNotMatch(fix, /Do not create, commit, push, merge, or modify a pull request in fix mode/);
  assert.doesNotMatch(fix, /Create or switch to the suggested branch/);
  const missingBranch = buildAIPrompt({ ...input, task: { ...task, branch: null }, mode: "FIX" });
  assert.match(missingBranch, /requires a real task branch/);
  assert.match(missingBranch, /do not invent agent\/tas-3-add-send-to-ai-task-action/);
  assert.doesNotMatch(missingBranch, /Work on the existing branch agent\/tas-3-add-send-to-ai-task-action/);
  assert.match(rereview, /Re-review mode:/);
  assert.match(rereview, /task was reviewed previously/);
  assert.match(rereview, /current head SHA against every review finding/);
  assert.match(rereview, /Do not assume approval/);
  assert.doesNotMatch(rereview, /Implement the task description and every Definition of done item/);
});

test("preserves an existing task branch and creates a shareable task URL", () => {
  assert.equal(suggestedTaskBranch(project, { ...task, branch: "feature/existing" }), "feature/existing");
  assert.equal(
    buildTaskContextUrl("http://127.0.0.1:5173/?settings=account", project, task),
    "http://127.0.0.1:5173/?view=board&project=TAS&task=TAS-3",
  );
});

test("handles projects without a configured repository", () => {
  const prompt = buildAIPrompt({ provider: "codex", project: { ...project, repoUrl: null }, task, phaseNumber: null, contextUrl: "https://taskforge.example/?project=TAS&task=TAS-3", apiBaseUrl: "https://api.taskforge.example/api/" });
  assert.match(prompt, /Not configured in TaskForge/);
  assert.match(prompt, /Phase: Not assigned/);
  assert.match(prompt, /https:\/\/api\.taskforge\.example\/api\/context/);
});

test("uses only enabled project statuses in handoff transitions", () => {
  const prompt = buildAIPrompt({
    provider: "codex",
    project: { ...project, availableStatuses: ["REFINING", "TODO", "READY_FOR_REVIEW", "CANCELLED"], defaultStatus: "TODO" },
    task: { ...task, status: "TODO" },
    phaseNumber: 1,
    contextUrl: "https://taskforge.example/?project=TAS&task=TAS-3",
    apiBaseUrl: "https://api.taskforge.example/api",
  });
  assert.match(prompt, /Enabled statuses: REFINING, TODO, READY_FOR_REVIEW, CANCELLED/);
  assert.match(prompt, /PATCH .* with branch .* only/);
  assert.match(prompt, /Move the task to READY_FOR_REVIEW when review is required/);
  assert.match(prompt, /Before reporting completion, refresh .*\/context\?project=TAS&task=TAS-3/);
  assert.doesNotMatch(prompt, /with status IN_PROGRESS/);
  assert.doesNotMatch(prompt, /Move the task to DONE/);
});

test("requires workflow discovery when no enabled review status exists", () => {
  const prompt = buildAIPrompt({
    provider: "cursor",
    project: { ...project, availableStatuses: ["TODO", "IN_PROGRESS", "CANCELLED"], defaultStatus: "TODO" },
    task: { ...task, status: "TODO" },
    phaseNumber: null,
    contextUrl: "https://taskforge.example/?project=TAS&task=TAS-3",
    apiBaseUrl: "https://api.taskforge.example/api",
  });
  assert.match(prompt, /with status IN_PROGRESS and branch/);
  assert.match(prompt, /Before requesting review, refresh/);
  assert.match(prompt, /If no review status is enabled, keep the status unchanged/);
  assert.doesNotMatch(prompt, /Move the task to (READY_FOR_REVIEW|IN_REVIEW|DONE)/);
});
