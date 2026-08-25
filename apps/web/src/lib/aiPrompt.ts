import { TASK_CLAIM_TARGET_STATUS, TASK_COMPLETION_STATUS, TASK_REVIEW_STATUSES, type Project, type Task } from "@taskforge/contracts";

export type AIProvider = "claude-code" | "codex" | "cursor";
export type AIPromptMode = "IMPLEMENT" | "REVIEW";

export const aiProviders: Array<{ id: AIProvider; name: string; badge: string; description: string; handoff: string }> = [
  { id: "claude-code", name: "Claude Code", badge: "C", description: "Terminal-first autonomous coding workflow", handoff: "Paste this prompt into Claude Code from the repository directory." },
  { id: "codex", name: "Codex", badge: "O", description: "Workspace-aware implementation and verification", handoff: "Paste this prompt into a Codex session opened on the repository." },
  { id: "cursor", name: "Cursor", badge: "Cu", description: "IDE agent with repository and terminal context", handoff: "Paste this prompt into Cursor Agent with the repository open." },
];

const providerInstructions: Record<AIProvider, string[]> = {
  "claude-code": [
    "Work through Claude Code from the repository root.",
    "Read CLAUDE.md, AGENTS.md, and repository-local guidance before editing.",
    "Inspect the relevant implementation before making changes, then work autonomously through validation and handoff.",
  ],
  codex: [
    "Work through Codex in the shared repository workspace.",
    "Read AGENTS.md and any applicable repository skills or instructions before editing.",
    "Preserve unrelated worktree changes, implement the smallest complete solution, and verify it before handoff.",
  ],
  cursor: [
    "Work through Cursor Agent with the repository opened as the active workspace.",
    "Use codebase search to understand existing patterns before editing files.",
    "Use the integrated terminal for tests and builds, and review the final diff before handoff.",
  ],
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export function suggestedTaskBranch(project: Project, task: Task) {
  return task.branch?.trim() || `agent/${project.key.toLowerCase()}-${task.number}-${slugify(task.title)}`;
}

export function buildTaskContextUrl(currentUrl: string, project: Project, task: Task) {
  const url = new URL(currentUrl);
  url.search = "";
  url.searchParams.set("view", "board");
  url.searchParams.set("project", project.key);
  url.searchParams.set("task", `${project.key}-${task.number}`);
  return url.toString();
}

export function buildAIPrompt({ provider, mode = "IMPLEMENT", project, task, phaseNumber, contextUrl, apiBaseUrl }: {
  provider: AIProvider;
  mode?: AIPromptMode;
  project: Project;
  task: Task;
  phaseNumber: number | null;
  contextUrl: string;
  apiBaseUrl: string;
}) {
  const providerMeta = aiProviders.find((item) => item.id === provider)!;
  const taskKey = `${project.key}-${task.number}`;
  const branch = suggestedTaskBranch(project, task);
  const normalizedApiBase = apiBaseUrl.replace(/\/$/, "");
  const contextEndpoint = `${normalizedApiBase}/context?project=${encodeURIComponent(project.key)}&task=${encodeURIComponent(taskKey)}`;
  const taskEndpoint = `${normalizedApiBase}/tasks/${task.id}`;
  const updatesEndpoint = `${taskEndpoint}/updates`;
  const attachmentsEndpoint = `${taskEndpoint}/attachments`;
  const repository = project.repoUrl?.trim() || "Not configured in TaskForge. Use the repository/workspace supplied by the operator; do not guess a repository.";
  const enabledStatuses = new Set(project.availableStatuses);
  const startInstruction = enabledStatuses.has(TASK_CLAIM_TARGET_STATUS)
    ? `- When starting, PATCH ${taskEndpoint} with status ${TASK_CLAIM_TARGET_STATUS} and branch ${branch}.`
    : `- When starting, PATCH ${taskEndpoint} with branch ${branch} only. No dedicated work status is enabled; keep the current status until you refresh workflow context and the project owner identifies the intended enabled transition.`;
  const reviewStatus = TASK_REVIEW_STATUSES.find((status) => enabledStatuses.has(status));
  const reviewInstruction = reviewStatus
    ? `- Move the task to ${reviewStatus} when review is required.`
    : `- Before requesting review, refresh ${contextEndpoint} to discover the current workflow. If no review status is enabled, keep the status unchanged and ask the project owner which enabled status to use.`;
  const completionInstruction = enabledStatuses.has(TASK_COMPLETION_STATUS)
    ? `- Move the task to ${TASK_COMPLETION_STATUS} only when the definition of done is fully satisfied and no review or follow-up remains.`
    : `- Before reporting completion, refresh ${contextEndpoint} to discover the current workflow. If no completion status is enabled, keep the status unchanged and ask the project owner which enabled status to use.`;
  const modeInstructions = mode === "REVIEW"
    ? [
      "Review mode:",
      "- Inspect the current implementation and compare it against every Definition of done item; do not assume the task is complete because a pull request exists.",
      "- Review code quality, correctness, security, performance, maintainability, tests, migrations, and responsive behavior where relevant.",
      "- Run the relevant tests, typechecks, lint, and production build, and verify the actual pull request diff and head SHA.",
      "- Report structured findings with severity, evidence, and a clear disposition recommendation. Do not merge or silently fix findings in review mode.",
    ]
    : [
      "Implementation mode:",
      "- Implement the task description and every Definition of done item with the smallest complete change.",
      "- Preserve unrelated work, run the relevant validation commands, and report progress, blockers, and final evidence through TaskForge.",
    ];

  return [
    `You are ${providerMeta.name}, responsible for completing TaskForge task ${taskKey}.`,
    "",
    "Provider workflow:",
    ...providerInstructions[provider].map((instruction) => `- ${instruction}`),
    "",
    "Task context:",
    `- Project: ${project.name} (${project.key})`,
    `- Task: ${taskKey} — ${task.title}`,
    `- Status: ${task.status}`,
    `- Enabled statuses: ${project.availableStatuses.join(", ")}`,
    `- Default API status: ${project.defaultStatus}`,
    `- Priority: ${task.priority}`,
    `- Type: ${task.type}`,
    `- Phase: ${phaseNumber === null ? "Not assigned" : `Phase ${phaseNumber}`}`,
    `- Estimate: ${task.estimatePoints === null ? "Not estimated" : `${task.estimatePoints} points`}`,
    `- Repository: ${repository}`,
    `- Suggested branch: ${branch}`,
    `- TaskForge URL: ${contextUrl}`,
    `- Attachments: ${task.attachments.length} (list with GET ${attachmentsEndpoint}; download each attachment using its downloadUrl)`,
    "",
    ...modeInstructions,
    "",
    "Description:",
    task.description || "No description provided.",
    "",
    "Definition of done:",
    task.definitionOfDone || "No definition of done provided. Confirm the expected outcome before making broad changes.",
    "",
    "TaskForge coordination:",
    "- Use the TaskForge credential already configured in your environment. Never print it, paste it into chat, commit it, or write it to repository files.",
    `- Resolve canonical context with GET ${contextEndpoint}. If access returns 403, stop and ask the project owner to add your agent as a project member.`,
    "- Before every status change, use project.availableStatuses from the latest context response and never PATCH a disabled status.",
    "- If this prompt came from a signed assignment with a runId, preserve that runId on status changes and run callbacks; redact tokens, secrets, and credentials from updates, logs, and findings.",
    startInstruction,
    `- Post meaningful progress and blocker notes to POST ${updatesEndpoint} with a JSON body containing the body field.`,
    "- When a pull request is opened, PATCH the task with pullRequestUrl, pullRequestTitle, pullRequestState, and the final branch.",
    reviewInstruction,
    completionInstruction,
    "",
    "Delivery workflow:",
    "1. Inspect the repository status and relevant code before editing; preserve unrelated changes.",
    "2. Create or switch to the suggested branch unless the task already specifies another branch.",
    "3. Implement every observable requirement in the definition of done, including tests and responsive behavior where applicable.",
    "4. Run the relevant typecheck, test, lint, and production build commands available in the repository.",
    "5. Review the diff for regressions, security issues, secrets, and accidental unrelated edits.",
    "6. Commit the focused change, push it, and open a pull request when repository access allows.",
    "7. Update TaskForge with the result, validation evidence, branch, and pull request. Clearly report any blocker instead of claiming completion.",
    "",
    `Begin by opening ${contextUrl} and the configured repository, then take ownership of ${taskKey} through completion.`,
  ].join("\n");
}
