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

test("task helper components are folder units", () => {
  for (const name of ["TaskTags", "TaskDependencies", "TaskTypePill"]) {
    const index = readFileSync(resolve(`src/components/${name}/index.ts`), "utf8");
    assert.match(index, new RegExp(`export \\{`));
    assert.equal(readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8").length > 0, true);
  }
});

test("SendToAI is a folder unit", () => {
  const index = readFileSync(resolve("src/components/SendToAI/index.ts"), "utf8");
  assert.match(index, /export \{ SendToAI \}/);
  assert.equal(readFileSync(resolve("src/components/SendToAI/SendToAI.module.css"), "utf8").length > 0, true);
});
