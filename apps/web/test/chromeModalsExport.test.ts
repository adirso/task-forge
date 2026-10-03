import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("App imports Login from pages/Login", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/Login["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/Login["']/);
});

test("Login unit exposes the required co-located files", () => {
  const root = resolve("src/pages/Login");
  for (const file of ["index.ts", "Login.tsx", "Login.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("App imports PhasesPage from pages/PhasesPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/PhasesPage["']/);
  assert.doesNotMatch(app, /PhaseManager/);
});

test("PhasesPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/PhasesPage");
  for (const file of ["index.ts", "PhasesPage.tsx", "PhasesPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("App imports AutomationsPage from pages/AutomationsPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/AutomationsPage["']/);
  assert.match(app, /<AutomationsPage/);
  assert.doesNotMatch(app, /AutomationManager/);
});

test("AutomationsPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/AutomationsPage");
  for (const file of ["index.ts", "AutomationsPage.tsx", "AutomationsPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("Settings imports AgentOpsPage from pages/AgentOpsPage", () => {
  const settings = readFileSync(resolve("src/pages/SettingsPage/SettingsPage.tsx"), "utf8");
  assert.match(settings, /from ["']\.\.\/AgentOpsPage["']/);
  assert.doesNotMatch(settings, /components\/AgentOpsPage/);
});

test("AgentOpsPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/AgentOpsPage");
  for (const file of ["index.ts", "AgentOpsPage.tsx", "AgentOpsPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

const SHELL = [
  "Sidebar",
  "Avatar",
  "NotificationPanel",
  "SearchPalette",
  "MultiFilterDropdown",
  "ProjectHeaderActions",
] as const;

test("shell chrome units are folders and App imports them from components/<Name>", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  for (const name of SHELL) {
    const root = resolve("src/components", name);
    assert.match(readFileSync(resolve(root, "index.ts"), "utf8"), new RegExp(name));
    for (const file of [`${name}.tsx`, `${name}.module.css`, "types.ts"]) {
      assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, `${name}/${file}`);
    }
    assert.doesNotMatch(app, new RegExp(`from ["']\\.\\/components\\/${name}\\.tsx["']`));
    if (name === "Avatar") {
      // Avatar is consumed by shell/pages/widgets, not App directly.
      assert.match(
        readFileSync(resolve("src/components/Sidebar/Sidebar.tsx"), "utf8"),
        /from ["']\.\.\/Avatar["']/,
      );
      continue;
    }
    assert.match(app, new RegExp(`from ["']\\.\\/components\\/${name}["']`));
  }
});

test("Sidebar keeps mobile className hook", () => {
  const tsx = readFileSync(resolve("src/components/Sidebar/Sidebar.tsx"), "utf8");
  assert.match(tsx, /className/);
  assert.match(readFileSync(resolve("src/App.tsx"), "utf8"), /mobile-sidebar/);
});

const MODALS = [
  "ProjectModal",
  "ProjectMembersModal",
  "ProjectDeleteModal",
  "PhaseDeleteModal",
  "PhaseMergeModal",
  "LogoutConfirmModal",
] as const;

test("modal units are folders and App imports them from components/<Name>", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  for (const name of MODALS) {
    const root = resolve("src/components", name);
    assert.match(readFileSync(resolve(root, "index.ts"), "utf8"), new RegExp(name));
    for (const file of [`${name}.tsx`, `${name}.module.css`, "types.ts"]) {
      assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, `${name}/${file}`);
    }
    if (name === "PhaseDeleteModal") {
      assert.match(
        readFileSync(resolve("src/pages/PhasesPage/PhasesPage.tsx"), "utf8"),
        /from ["']\.\.\/\.\.\/components\/PhaseDeleteModal["']/,
      );
      continue;
    }
    assert.match(app, new RegExp(`from ["']\.\/components\/${name}["']`));
  }
});

test("legacy chrome/modal/page selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles.css"), "utf8");
  for (const selector of [
    ".login-page",
    ".phases-page",
    ".automation-page",
    ".agent-ops",
    ".sidebar ",
    ".notification-panel",
    ".search-palette",
    ".multi-filter-trigger",
    ".project-modal",
    ".phase-merge-modal",
    ".logout-modal",
  ]) {
    assert.equal(css.includes(selector.trimEnd()), false, selector);
  }
});
