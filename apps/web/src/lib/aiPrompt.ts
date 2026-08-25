import { TASK_CLAIM_TARGET_STATUS, TASK_COMPLETION_STATUS, TASK_REVIEW_STATUSES, type Project, type Task } from "@taskforge/contracts";

export type AIProvider = "claude-code" | "codex" | "cursor";
export type AIPromptMode = "IMPLEMENT" | "REVIEW" | "FIX" | "RE_REVIEW";

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
  const existingBranch = task.branch?.trim() || null;
  const normalizedApiBase = apiBaseUrl.replace(/\/$/, "");
  const contextEndpoint = `${normalizedApiBase}/context?project=${encodeURIComponent(project.key)}&task=${encodeURIComponent(taskKey)}`;
  const taskEndpoint = `${normalizedApiBase}/tasks/${task.id}`;
  const updatesEndpoint = `${taskEndpoint}/updates`;
  const agentLogsEndpoint = `${taskEndpoint}/agent-logs`;
  const attachmentsEndpoint = `${taskEndpoint}/attachments`;
  const repository = project.repoUrl?.trim() || "Not configured in TaskForge. Use the repository/workspace supplied by the operator; do not guess a repository.";
  const enabledStatuses = new Set(project.availableStatuses);
  const reviewStatus = TASK_REVIEW_STATUSES.find((status) => enabledStatuses.has(status));
  const readOnlyMode = mode === "REVIEW" || mode === "RE_REVIEW";
  const startInstruction = readOnlyMode
    ? mode === "RE_REVIEW" && enabledStatuses.has("RE_REVIEW")
      ? `- Re-review mode is read-only: do not start implementation or PATCH ${taskEndpoint} to ${TASK_CLAIM_TARGET_STATUS}. If the workflow requires entering re-review, refresh ${contextEndpoint} and PATCH ${taskEndpoint} with status RE_REVIEW; otherwise leave the current status unchanged.`
      : reviewStatus
        ? `- Review mode is read-only: do not start implementation or PATCH ${taskEndpoint} to ${TASK_CLAIM_TARGET_STATUS}. If the workflow requires entering review, refresh ${contextEndpoint} and PATCH ${taskEndpoint} with status ${reviewStatus}; otherwise leave the current status unchanged.`
        : `- Review mode is read-only: do not change the task status. Refresh ${contextEndpoint}; if no review status is enabled, leave the current status unchanged and report that the operator must choose the review state.`
    : mode === "FIX"
      ? existingBranch
        ? `- Fix mode must stay on the existing branch ${existingBranch}; do not create or switch branches. Refresh ${contextEndpoint}, read the latest findings from ${updatesEndpoint} and ${agentLogsEndpoint}, then move to ${TASK_CLAIM_TARGET_STATUS} only when that enabled workflow status is the correct start state.`
        : `- Fix mode requires a real task branch. No branch is configured, so stop before editing, do not invent ${branch}, and ask the operator to set the review branch in TaskForge.`
      : enabledStatuses.has(TASK_CLAIM_TARGET_STATUS)
      ? `- When starting, PATCH ${taskEndpoint} with status ${TASK_CLAIM_TARGET_STATUS} and branch ${branch}.`
      : `- When starting, PATCH ${taskEndpoint} with branch ${branch} only. No dedicated work status is enabled; keep the current status until you refresh workflow context and the project owner identifies the intended enabled transition.`;
  const reviewInstruction = readOnlyMode
    ? `- ${mode === "RE_REVIEW" ? "Re-review" : "Review"} mode does not hand off implementation or mark the task complete. Record findings and evidence, then leave approval, fixes, re-review, and merge decisions to the configured workflow and operator.`
    : mode === "FIX"
      ? `- Resolve every finding from the latest human updates and agent logs, add tests for each fix, and move the task to ${reviewStatus ?? "the enabled review status discovered from workflow context"} when ready for another review. Do not mark the task approved or done.`
    : reviewStatus
      ? `- Move the task to ${reviewStatus} when review is required.`
      : `- Before requesting review, refresh ${contextEndpoint} to discover the current workflow. If no review status is enabled, keep the status unchanged and ask the project owner which enabled status to use.`;
  const completionInstruction = readOnlyMode || mode === "FIX"
    ? `- ${mode === "FIX" ? "Fix work" : "Review completion"} means findings and validation evidence are reported; do not move the task to a completion status from this prompt.`
    : enabledStatuses.has(TASK_COMPLETION_STATUS)
      ? `- Move the task to ${TASK_COMPLETION_STATUS} only when the definition of done is fully satisfied and no review or follow-up remains.`
      : `- Before reporting completion, refresh ${contextEndpoint} to discover the current workflow. If no completion status is enabled, keep the status unchanged and ask the project owner which enabled status to use.`;
  const pullRequestInstruction = readOnlyMode || mode === "FIX"
    ? mode === "FIX"
      ? "- In fix mode, commit and push fixes to the existing branch and pull request when one exists; do not create a new branch, open a replacement pull request, approve, or merge."
      : "- Do not create, commit, push, merge, or modify a pull request in review mode; report evidence against the existing implementation."
    : "- When a pull request is opened, PATCH the task with pullRequestUrl, pullRequestTitle, pullRequestState, and the final branch.";
  const modeInstructions = mode === "REVIEW"
    ? [
      "Review mode:",
      "- Inspect the current implementation and compare it against every Definition of done item; do not assume the task is complete because a pull request exists.",
      "- Review code quality, correctness, security, performance, maintainability, tests, migrations, responsive behavior, and optimization opportunities where relevant.",
      "- Run the relevant tests, typechecks, lint, and production build, and verify the actual pull request diff and head SHA.",
      "- Report structured findings with severity, evidence, and a clear disposition recommendation. Do not merge or silently fix findings in review mode.",
    ]
    : mode === "RE_REVIEW"
      ? [
      "Re-review mode:",
      "- This task was reviewed previously. Read the latest human updates and provider findings from the task updates and agent-logs endpoints before inspecting the current head.",
      "- Compare the current implementation and current head SHA against every review finding and every Definition of done item; report which findings are cleared and which remain.",
      "- Run focused validation and report structured remaining findings with severity and evidence. Do not assume approval, merge, or silently modify the implementation.",
    ]
    : mode === "FIX"
      ? [
      "Fix needed mode:",
      existingBranch
        ? `- Work on the existing branch ${existingBranch}; do not create a new branch or move the task to another branch.`
        : `- No existing task branch is configured. Stop before editing and ask the operator to set the review branch; never invent ${branch}.`,
      `- Read the latest human review updates from GET ${updatesEndpoint} and provider output/findings from GET ${agentLogsEndpoint}; identify each finding, severity, and requested disposition.`,
      "- Resolve and test every finding individually, preserve unrelated work, and report the evidence for each fix. If a finding is unclear, ask for a decision instead of guessing.",
      "- Leave approval and merge decisions to the subsequent review; request re-review after validation rather than declaring the task approved.",
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
    `- Post meaningful progress and blocker notes to POST ${updatesEndpoint} with a JSON body containing the body field. Human updates should summarize decisions and handoffs; provider output belongs in agent logs when available.`,
    `- For Fix needed and Re-review, use GET ${agentLogsEndpoint} alongside ${updatesEndpoint} to recover the latest findings before acting.`,
    pullRequestInstruction,
    reviewInstruction,
    completionInstruction,
    "",
    "Delivery workflow:",
    ...(readOnlyMode ? [
      "1. Inspect the current repository status, branch, pull request diff, and exact head SHA; do not edit files.",
      "2. Compare the implementation against every Definition of done item and identify missing, risky, or unnecessary work.",
      "3. Run the relevant typecheck, test, lint, and production build commands available in the repository.",
      "4. Review security, secrets, migrations, performance, maintainability, and responsive behavior where applicable.",
      "5. Post structured findings with severity, evidence, and a disposition recommendation to TaskForge; do not commit, push, open, or merge a pull request.",
    ] : mode === "FIX" ? [
      "1. Inspect the current repository, existing branch, and latest review findings before editing; preserve unrelated changes.",
      "2. Work only on the existing branch and implement the smallest fixes for every finding, including regression tests where appropriate.",
      "3. Run the relevant typecheck, test, lint, and production build commands available in the repository.",
      "4. Review the diff for regressions, security issues, secrets, and accidental unrelated edits; report each finding’s resolution.",
      "5. Commit and push the fixes to the existing branch/PR when applicable, then update TaskForge with validation evidence and request re-review; do not approve, merge, or open a replacement branch.",
    ] : [
      "1. Inspect the repository status and relevant code before editing; preserve unrelated changes.",
      "2. Create or switch to the suggested branch unless the task already specifies another branch.",
      "3. Implement every observable requirement in the definition of done, including tests and responsive behavior where applicable.",
      "4. Run the relevant typecheck, test, lint, and production build commands available in the repository.",
      "5. Review the diff for regressions, security issues, secrets, and accidental unrelated edits.",
      "6. Commit the focused change, push it, and open a pull request when repository access allows.",
      "7. Update TaskForge with the result, validation evidence, branch, and pull request. Clearly report any blocker instead of claiming completion.",
    ]),
    "",
    `Begin by opening ${contextUrl} and the configured repository, then ${readOnlyMode ? `review ${taskKey} and report findings` : mode === "FIX" ? `resolve the review findings for ${taskKey} on its existing branch` : `take ownership of ${taskKey} through completion`}.`,
  ].join("\n");
}
