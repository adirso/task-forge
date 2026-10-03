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

test("SettingsPage includes AgentsSection parts tree", () => {
  const required = [
    "parts/AgentsSection/AgentsSection.tsx",
    "parts/AgentsSection/parts/NewAgentForm/NewAgentForm.tsx",
    "parts/AgentsSection/parts/AgentPicker/AgentPicker.tsx",
    "parts/AgentsSection/parts/AgentDetail/AgentDetail.tsx",
  ];
  for (const rel of required) {
    assert.equal(readFileSync(resolve("src/pages/SettingsPage", rel), "utf8").length > 0, true, rel);
  }
});

test("Settings-owned shared components are folder units", () => {
  for (const name of [
    "WebhookManager",
    "WebhookDeliveriesPanel",
    "RevealTokenConfirmModal",
    "RevokeTokenConfirmModal",
    "AgentCapabilityEditor",
  ]) {
    const index = readFileSync(resolve(`src/components/${name}/index.ts`), "utf8");
    assert.match(index, new RegExp(`export \\{ ${name} \\}`));
    assert.equal(readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8").length > 0, true);
  }
});

test("SettingsPage AgentDetail panels and BackupSection exist", () => {
  const files = [
    "parts/AgentsSection/parts/AgentDetail/parts/AccessPanel/AccessPanel.tsx",
    "parts/AgentsSection/parts/AgentDetail/parts/DeliveriesPanel/DeliveriesPanel.tsx",
    "parts/BackupSection/BackupSection.tsx",
  ];
  for (const rel of files) {
    assert.equal(readFileSync(resolve("src/pages/SettingsPage", rel), "utf8").length > 0, true, rel);
  }
});

test("legacy Settings selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles/global.css"), "utf8");
  for (const selector of [".settings-page", ".agent-manager", ".webhook-deliveries", ".new-agent-form", ".backup-card"]) {
    assert.equal(css.includes(selector), false, selector);
  }
});
