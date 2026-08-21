import assert from "node:assert/strict";
import { test } from "node:test";
import { createUnitOfWork, type DatabasePort } from "../src/infrastructure/database.js";

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
    return "committed";
  });
  assert.equal(result, "committed");
  assert.equal(transactionCalls, 1);
});
