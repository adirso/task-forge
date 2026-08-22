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
