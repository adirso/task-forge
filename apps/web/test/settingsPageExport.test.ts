import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("App imports SettingsPage from pages/SettingsPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/SettingsPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/SettingsPage["']/);
});

test("SettingsPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/SettingsPage");
  for (const file of ["index.ts", "SettingsPage.tsx", "SettingsPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});

test("SettingsPage includes Account and Appearance parts", () => {
  for (const part of ["AccountSection", "AppearanceSection"]) {
    const base = resolve(`src/pages/SettingsPage/parts/${part}`);
    for (const file of [`${part}.tsx`, `${part}.module.css`, "types.ts", "index.ts"]) {
      assert.equal(readFileSync(resolve(base, file), "utf8").length > 0, true, `${part}/${file}`);
    }
  }
});
