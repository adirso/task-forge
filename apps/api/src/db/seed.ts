import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { DEFAULT_WORKFLOW_STATUSES } from "../application/workflow.js";
import { db } from "./database.js";

const ids = {
  admin: "11111111-1111-4111-8111-111111111111",
  maya: "22222222-2222-4222-8222-222222222222",
  agent: "33333333-3333-4333-8333-333333333333",
  project: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const now = new Date().toISOString();
const passwordHash = await bcrypt.hash("demo1234", 12);

await db.transaction(async () => {
  const insertUser = await db.prepare(`INSERT OR IGNORE INTO users
    (id, email, name, password_hash, kind, role, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  await insertUser.run(ids.admin, "demo@taskforge.local", "Alex Morgan", passwordHash, "HUMAN", "ADMIN", null, now);
  await insertUser.run(ids.maya, "maya@taskforge.local", "Maya Chen", passwordHash, "HUMAN", "MEMBER", null, now);
  await insertUser.run(ids.agent, "builder@agents.taskforge.local", "Builder Agent", null, "AGENT", "MEMBER", null, now);

  await db.prepare(`INSERT OR IGNORE INTO projects
    (id, \`key\`, name, description, repo_url, color, owner_id, next_task_number, created_at, updated_at)
    VALUES (?, 'TF', 'TaskForge', 'Build a focused workspace where people and agents can plan and ship together.',
      'https://github.com/adirso/task-forge', '#6554C0', ?, 11, ?, ?)`)
    .run(ids.project, ids.admin, now, now);

  const insertProjectStatus = db.prepare(`INSERT OR IGNORE INTO project_statuses
    (id, project_id, \`key\`, label, color, category, position, is_initial, is_claimable, is_claim_target,
      triggers_review, tracks_staleness, satisfies_dependencies, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    await insertProjectStatus.run(randomUUID(), ids.project, status.key, status.label, status.color, status.category, status.position,
      status.isInitial ? 1 : 0, status.isClaimable ? 1 : 0, status.isClaimTarget ? 1 : 0, status.triggersReview ? 1 : 0,
      status.tracksStaleness ? 1 : 0, status.satisfiesDependencies ? 1 : 0, now, now);
  }

  const insertMember = await db.prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)");
  await insertMember.run(ids.project, ids.admin, "OWNER", now);
  await insertMember.run(ids.project, ids.maya, "MEMBER", now);
  await insertMember.run(ids.project, ids.agent, "MEMBER", now);

  const phases = {
    foundation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    delivery: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    next: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
  const insertPhase = await db.prepare(`INSERT OR IGNORE INTO phases (id, project_id, number, goal, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  await insertPhase.run(phases.foundation, ids.project, 1, "Establish the secure API and core data model.", 0, now, now);
  await insertPhase.run(phases.delivery, ids.project, 2, "Ship a polished workspace for people and agents.", 1, now, now);
  await insertPhase.run(phases.next, ids.project, 3, "Improve collaboration, notifications, and planning workflows.", 0, now, now);

  const insertTask = await db.prepare(`INSERT OR IGNORE INTO tasks
    (id, project_id, number, title, description, definition_of_done, status, priority, type, assignee_id, creator_id,
      parent_id, branch, due_date, estimate_points, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const tasks = [
    ["00000001-0000-4000-8000-000000000001", 1, "Design authentication flow", "Define sign-in and API-token behavior for people and agents.", "JWT sessions expire; agent tokens can be revoked; API returns consistent 401 responses.", "DONE", "HIGH", "SECURITY", ids.maya, ids.admin, null, "feature/auth-flow", null, 5, 0],
    ["00000002-0000-4000-8000-000000000002", 2, "Create project dashboard", "Build the primary workspace and navigation shell.", "Board and list views are responsive and share the same task data.", "IN_PROGRESS", "HIGH", "FEATURE", ids.admin, ids.admin, null, "feature/project-dashboard", null, 8, 0],
    ["00000003-0000-4000-8000-000000000003", 3, "Add task filters", "Filter by assignee, priority, and free-text search.", "Filters can be combined and cleared without reloading.", "TODO", "MEDIUM", "FEATURE", ids.agent, ids.admin, "00000002-0000-4000-8000-000000000002", "feature/task-filters", null, 3, 0],
    ["00000004-0000-4000-8000-000000000004", 4, "Document agent API", "Provide examples for authentication and task lifecycle operations.", "README includes copy-paste curl examples and token safety guidance.", "IN_REVIEW", "MEDIUM", "DOCS", ids.agent, ids.maya, null, "docs/agent-api", null, 3, 0],
    ["00000005-0000-4000-8000-000000000005", 5, "Plan notification rules", "Decide which task events should notify project members.", "Event matrix covers assignment, mentions, due dates, and status changes.", "BACKLOG", "LOW", "FEATURE", null, ids.admin, null, null, null, 2, 0],
    ["00000006-0000-4000-8000-000000000006", 6, "Database migration strategy", "Add a safe path for future schema migrations.", "Migrations are ordered, transactional, and documented.", "TODO", "URGENT", "INFRA", ids.admin, ids.admin, null, "chore/migrations", null, 5, 1],
    ["00000007-0000-4000-8000-000000000007", 7, "Polish empty states", "Make first-run and filtered-empty screens useful.", "Each empty state offers a clear next action.", "BACKLOG", "LOW", "CHORE", ids.maya, ids.admin, null, null, null, 2, 1],
    ["00000008-0000-4000-8000-000000000008", 8, "API error envelope", "Normalize validation and authorization error responses.", "All client errors use a stable JSON shape.", "DONE", "MEDIUM", "BUG", ids.agent, ids.admin, null, "fix/error-envelope", null, 3, 1],
    ["00000009-0000-4000-8000-000000000009", 9, "Responsive list layout", "Keep the task table readable on laptop and tablet widths.", "Primary columns remain visible and overflow is accessible.", "IN_PROGRESS", "MEDIUM", "UPDATE", ids.maya, ids.admin, "00000002-0000-4000-8000-000000000002", "feature/responsive-list", null, 5, 1],
    ["00000010-0000-4000-8000-000000000010", 10, "Add API health check", "Expose service health for local orchestration.", "GET /health returns HTTP 200 and a stable payload.", "DONE", "LOW", "INFRA", ids.agent, ids.admin, null, null, null, 1, 2],
  ] as const;

  for (const task of tasks) {
    const existingTask = await db.prepare("SELECT id FROM tasks WHERE project_id = ? AND title = ?").get(ids.project, task[2]);
    if (existingTask) continue;
    await insertTask.run(task[0], ids.project, ...task.slice(1), now, now);
  }
  await db.prepare(`UPDATE tasks SET phase_id = CASE
    WHEN number IN (1, 8, 10) THEN ?
    WHEN number IN (2, 3, 4, 6, 9) THEN ?
    ELSE ? END WHERE project_id = ? AND phase_id IS NULL`)
    .run(phases.foundation, phases.delivery, phases.next, ids.project);
  await db.prepare("UPDATE tasks SET pull_request_url = ?, pull_request_title = ?, pull_request_state = 'OPEN' WHERE id = ?")
    .run("https://github.com/example/taskforge/pull/42", "Document agent authentication and task lifecycle", "00000004-0000-4000-8000-000000000004");

  const insertUpdate = await db.prepare(`INSERT OR IGNORE INTO task_updates (id, task_id, author_id, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  await insertUpdate.run("80000001-0000-4000-8000-000000000001", "00000004-0000-4000-8000-000000000004", ids.agent, "Opened PR #42 with authentication, token rotation, and task lifecycle examples. Ready for a first review pass.", now, now);
  await insertUpdate.run("80000002-0000-4000-8000-000000000002", "00000002-0000-4000-8000-000000000002", ids.maya, "The responsive list subtask is underway. I’m keeping the primary fields visible down to tablet width.", now, now);

  const insertNotification = await db.prepare(`INSERT OR IGNORE INTO notifications
    (id, user_id, project_id, task_id, type, title, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  await insertNotification.run("90000001-0000-4000-8000-000000000001", ids.admin, ids.project, "00000004-0000-4000-8000-000000000004", "REVIEW_REQUESTED", "Review requested", "Builder Agent moved “Document agent API” to review.", now);
  await insertNotification.run("90000002-0000-4000-8000-000000000002", ids.admin, ids.project, "00000006-0000-4000-8000-000000000006", "TASK_ASSIGNED", "Task assigned to you", "You were assigned “Database migration strategy”.", now);
  await insertNotification.run("90000003-0000-4000-8000-000000000003", ids.admin, ids.project, "00000002-0000-4000-8000-000000000002", "TASK_UPDATED", "Dashboard work updated", "Maya added a responsive list subtask.", now);
})();

console.log("Seed complete. Sign in with demo@taskforge.local / demo1234");
