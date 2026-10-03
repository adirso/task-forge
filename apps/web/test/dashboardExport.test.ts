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

test("App imports DashboardPage from pages/DashboardPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/DashboardPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/DashboardPage["']/);
});

test("DashboardPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/DashboardPage");
  for (const file of ["index.ts", "DashboardPage.tsx", "DashboardPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("App imports ProjectDashboardPage from pages/ProjectDashboardPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/ProjectDashboardPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/ProjectDashboard["']/);
  assert.match(app, /<ProjectDashboardPage/);
});

test("ProjectDashboardPage unit exposes shell and parts tree", () => {
  const root = resolve("src/pages/ProjectDashboardPage");
  for (const file of ["index.ts", "ProjectDashboardPage.tsx", "ProjectDashboardPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
  for (const part of ["ProjectBars", "ProjectModuleContent"]) {
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.tsx`), "utf8").length > 0, true, part);
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.module.css`), "utf8").length > 0, true, `${part}.css`);
  }
});

test("legacy dashboard/widget selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles/global.css"), "utf8");
  for (const selector of [
    ".dashboard-page",
    ".dashboard-fab",
    ".widget-card",
    ".widget-picker",
    ".widget-project-status",
    ".project-dashboard-heading",
    ".project-chart",
    ".project-dashboard-modular",
  ]) {
    assert.equal(css.includes(selector), false, selector);
  }
});
