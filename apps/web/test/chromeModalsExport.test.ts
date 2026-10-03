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
