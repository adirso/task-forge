import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("WidgetShell is a folder unit with drag-handle hook", () => {
  const index = readFileSync(resolve("src/components/WidgetShell/index.ts"), "utf8");
  assert.match(index, /WidgetShell/);
  assert.match(index, /WidgetError/);
  const tsx = readFileSync(resolve("src/components/WidgetShell/WidgetShell.tsx"), "utf8");
  assert.match(tsx, /widget-drag-handle/);
  for (const file of ["WidgetShell.tsx", "WidgetShell.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve("src/components/WidgetShell", file), "utf8").length > 0, true, file);
  }
});

const WIDGETS = [
  "ProjectStatusWidget",
  "ProjectProgressWidget",
  "ProjectTimeWidget",
  "MyTasksWidget",
  "StuckTasksWidget",
  "ActivityWidget",
  "AgentOpsWidget",
] as const;

test("home widgets are folder units", () => {
  for (const name of WIDGETS) {
    const root = resolve("src/components/widgets", name);
    const index = readFileSync(resolve(root, "index.ts"), "utf8");
    assert.match(index, new RegExp(`export \\{ ${name} \\}`));
    for (const file of [`${name}.tsx`, `${name}.module.css`, "types.ts"]) {
      assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, `${name}/${file}`);
    }
  }
});

test("ModularDashboard is a folder unit exporting ModuleLayout", () => {
  const index = readFileSync(resolve("src/components/ModularDashboard/index.ts"), "utf8");
  assert.match(index, /ModularDashboard/);
  assert.match(index, /ModuleLayout/);
  const tsx = readFileSync(resolve("src/components/ModularDashboard/ModularDashboard.tsx"), "utf8");
  assert.match(tsx, /widget-drag-handle/);
  assert.match(tsx, /dashboard-page/);
  for (const file of ["ModularDashboard.tsx", "ModularDashboard.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve("src/components/ModularDashboard", file), "utf8").length > 0, true, file);
  }
});

test("projectDashboard imports ModuleLayout from ModularDashboard folder", () => {
  const src = readFileSync(resolve("src/lib/projectDashboard.ts"), "utf8");
  assert.match(src, /from ["']\.\.\/components\/ModularDashboard["']/);
  assert.doesNotMatch(src, /ModularDashboard\.tsx/);
});
