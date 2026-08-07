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
    assert.match(prompt, /https:\/\/github\.com\/adirso\/task-forge/);
    assert.match(prompt, /agent\/tas-3-add-send-to-ai-task-action/);
    assert.match(prompt, /\/api\/context\?project=TAS&task=TAS-3/);
    assert.match(prompt, /pullRequestUrl/);
    assert.match(prompt, /Never print it, paste it into chat, commit it, or write it to repository files/);
    assert.doesNotMatch(prompt, /taskforge_token|localStorage|gho_[A-Za-z0-9]+/);
  }
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
