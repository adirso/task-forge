import assert from "node:assert/strict";
import { test } from "node:test";
import { createUnitOfWork, type DatabasePort } from "../src/infrastructure/database.js";
import { createRepositories } from "../src/infrastructure/repositories.js";

test("unit of work exposes the complete repository set through the database port", async () => {
  let transactionCalls = 0;
  const database: DatabasePort = {
    dialect: "sqlite",
    prepare() { throw new Error("repository query should not run in this boundary test"); },
    transaction(callback) {
      return async () => { transactionCalls += 1; return callback(); };
    },
  };
  const result = await createUnitOfWork(database).run(async (repositories) => {
    assert.ok(repositories.users);
    assert.ok(repositories.projects);
    assert.ok(repositories.tasks);
    assert.ok(repositories.dependencies);
    assert.ok(repositories.search);
    assert.ok(repositories.reporting);
    return "committed";
  });
  assert.equal(result, "committed");
  assert.equal(transactionCalls, 1);
});

test("reporting repository owns portable reporting queries and row mapping", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const database: DatabasePort = {
    dialect: "mysql",
    prepare(sql) {
      return {
        async get() { return undefined; },
        async run() { return { changes: 0 }; },
        async all(...params) {
          queries.push({ sql, params });
          if (sql.includes("COUNT(*) AS task_count")) return [{ project_id: "project-1", status: "TODO", task_count: "2" }];
          if (sql.includes("t.assignee_id = ? AND t.status NOT IN")) return [{ id: "task-1", number: 7, title: "Assigned", project_id: "project-1", status: "TODO", assignee_id: "agent-1", updated_at: "2026-08-22T10:00:00.000Z", project_key: "TAS", project_name: "Task Forge", assignee_name: "Agent" }];
          if (sql.includes("t.updated_at < ?")) return [{ id: "task-2", number: 8, title: "Stuck", project_id: "project-1", status: "IN_PROGRESS", assignee_id: "agent-1", updated_at: "2026-08-22T06:00:00.000Z", project_key: "TAS", project_name: "Task Forge", assignee_name: "Agent" }];
          if (sql.includes("t.assignee_id IN") && sql.includes("t.status = 'IN_PROGRESS'")) return [{ id: "task-2", number: 8, title: "Stuck", project_id: "project-1", status: "IN_PROGRESS", assignee_id: "agent-1", updated_at: "2026-08-22T06:00:00.000Z", project_key: "TAS", project_name: "Task Forge", assignee_name: "Agent" }];
          if (sql.includes("MAX(last_used_at)")) return [{ user_id: "agent-1", last_active_at: "2026-08-22T09:00:00.000Z" }];
          return [];
        },
      };
    },
    transaction(callback) { return callback; },
  };
  const reporting = createRepositories(database).reporting;
  assert.deepEqual(await reporting.countTasksByProject(["project-1"]), [{ projectId: "project-1", status: "TODO", count: 2 }]);
  assert.equal((await reporting.listMyOpenTasks("agent-1", 30))[0]?.projectKey, "TAS");
  assert.equal((await reporting.listStuckTasks(["project-1"], "2026-08-22T08:00:00.000Z", 20))[0]?.title, "Stuck");
  assert.equal((await reporting.listAgentInProgressTasks(["agent-1"]))[0]?.assigneeId, "agent-1");
  assert.deepEqual(await reporting.listAgentLastActive(["agent-1"]), [{ agentId: "agent-1", lastActiveAt: "2026-08-22T09:00:00.000Z" }]);
  assert.ok(queries.every(({ sql }) => !sql.includes("? = 1 OR EXISTS")), "reporting queries must receive already-authorized project IDs");
  assert.ok(queries.some(({ sql, params }) => sql.includes("LIMIT 30") && params.length === 1), "MySQL-compatible limits are normalized before interpolation");
  assert.ok(queries.some(({ sql, params }) => sql.includes("LIMIT 20") && params.at(-1) === "2026-08-22T08:00:00.000Z"), "stuck-task limits do not use prepared placeholders");
});

test("claim repository repeats enabled source eligibility in the atomic update", async () => {
  const queries: Array<{ operation: "get" | "run" | "all"; sql: string; params: unknown[] }> = [];
  const database: DatabasePort = {
    dialect: "mysql",
    prepare(sql) {
      return {
        async get(...params) {
          queries.push({ operation: "get", sql, params });
          if (sql.startsWith("SELECT id, status FROM tasks")) return { id: "task-49", status: "READY_FOR_DEV" };
          if (sql.startsWith("SELECT * FROM tasks")) return { id: "task-49", project_id: "project-1", number: 49, title: "Ready work", description: "", definition_of_done: "", status: "IN_PROGRESS", priority: "HIGH", type: "BUG", assignee_id: null, creator_id: "owner-1", parent_id: null, branch: null, due_date: null, estimate_points: null, phase_id: null, pull_request_url: null, pull_request_title: null, pull_request_state: null, position: 0, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T01:00:00.000Z" };
          return undefined;
        },
        async run(...params) { queries.push({ operation: "run", sql, params }); return { changes: 1 }; },
        async all(...params) { queries.push({ operation: "all", sql, params }); return []; },
      };
    },
    transaction(callback) { return callback; },
  };
  const claimed = await createRepositories(database).tasks.claimNext(
    "project-1",
    "agent-1",
    { sourceStatuses: ["BACKLOG", "TODO", "READY_FOR_DEV"], targetStatus: "IN_PROGRESS" },
  );
  assert.equal(claimed?.status, "IN_PROGRESS");
  const candidate = queries.find(({ operation, sql }) => operation === "get" && sql.startsWith("SELECT id, status FROM tasks"));
  const update = queries.find(({ operation, sql }) => operation === "run" && sql.startsWith("UPDATE tasks SET assignee_id"));
  assert.match(candidate?.sql ?? "", /status IN \(\?, \?, \?\)/);
  assert.deepEqual(candidate?.params.slice(0, 4), ["project-1", "BACKLOG", "TODO", "READY_FOR_DEV"]);
  assert.match(update?.sql ?? "", /project_id = \? AND status IN \(\?, \?, \?\) AND assignee_id IS NULL/);
  assert.deepEqual(update?.params.slice(0, 2), ["agent-1", "IN_PROGRESS"]);
  assert.deepEqual(update?.params.slice(-4), ["project-1", "BACKLOG", "TODO", "READY_FOR_DEV"]);
});

test("large task pages use a bounded number of relationship queries", async () => {
  const queries: string[] = [];
  const taskRows = Array.from({ length: 75 }, (_, index) => ({
    id: `task-${String(index).padStart(3, "0")}`, project_id: "project-1", number: index + 1, title: `Task ${index + 1}`,
    description: "", definition_of_done: "", status: "TODO", priority: "MEDIUM", type: "FEATURE", assignee_id: null,
    creator_id: "owner-1", parent_id: null, branch: null, due_date: null, estimate_points: null, phase_id: null,
    pull_request_url: null, pull_request_title: null, pull_request_state: null, position: index,
    created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z",
  }));
  const database: DatabasePort = {
    dialect: "sqlite",
    prepare(sql) {
      queries.push(sql);
      return {
        async get() { return undefined; },
        async run() { return { changes: 0 }; },
        async all() { return sql.startsWith("SELECT * FROM tasks WHERE") || sql.startsWith("SELECT t.*") ? taskRows.map((row) => ({ ...row, project_name: "Task Forge", project_key: "TAS", project_color: "#6554C0" })) : []; },
      };
    },
    transaction(callback) { return callback; },
  };
  const result = await createRepositories(database).tasks.listByProject("project-1", undefined, { limit: 100 });
  assert.equal(result.items.length, 75);
  assert.equal(result.page.hasMore, false);
  assert.ok(queries.length <= 6, `expected at most 6 queries for 75 tasks, received ${queries.length}`);
  assert.equal(queries.filter((sql) => sql.includes("task_id IN")).length, 4, "task relationships and durations are loaded in batches");
  queries.length = 0;
  const search = await createRepositories(database).search.searchAccessible({ actorId: "owner-1", isAdmin: true, query: "Task", page: { limit: 100 } });
  assert.equal(search.items.length, 75);
  assert.ok(queries.length <= 6, `expected at most 6 search queries for 75 tasks, received ${queries.length}`);
});
