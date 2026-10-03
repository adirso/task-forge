import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("App imports TaskModal from components/TaskModal", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/components\/TaskModal["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/TaskModal\.tsx["']/);
});

test("TaskModal unit exposes the required co-located files", () => {
  const root = resolve("src/components/TaskModal");
  for (const file of ["index.ts", "TaskModal.tsx", "TaskModal.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});
