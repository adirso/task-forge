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

test("App imports ListPage from pages/ListPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/ListPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/ListView["']/);
});

test("ListPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/ListPage");
  for (const file of ["index.ts", "ListPage.tsx", "ListPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("App imports BoardPage from pages/BoardPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/BoardPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/BoardView["']/);
  assert.doesNotMatch(app, /active-phase-banner/);
});

test("BoardPage unit exposes shell and parts tree", () => {
  const root = resolve("src/pages/BoardPage");
  for (const file of ["index.ts", "BoardPage.tsx", "BoardPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
  for (const part of ["PhaseBanner", "BoardColumns"]) {
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.tsx`), "utf8").length > 0, true, part);
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.module.css`), "utf8").length > 0, true, `${part}.css`);
  }
});
