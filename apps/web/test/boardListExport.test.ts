import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("TaskCard is a folder unit", () => {
  const index = readFileSync(resolve("src/components/TaskCard/index.ts"), "utf8");
  assert.match(index, /export \{ TaskCard \}/);
  for (const file of ["TaskCard.tsx", "TaskCard.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve("src/components/TaskCard", file), "utf8").length > 0, true, file);
  }
});

test("TaskTags and TaskDependencies no longer shim task-card layout", () => {
  for (const name of ["TaskTags", "TaskDependencies"]) {
    const css = readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8");
    assert.equal(css.includes(":global(.task-card)"), false, name);
  }
});
