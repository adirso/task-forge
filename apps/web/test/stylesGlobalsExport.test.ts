import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("main imports styles/global.css instead of styles.css", () => {
  const main = readFileSync(resolve("src/main.tsx"), "utf8");
  assert.match(main, /from ["']\.\/styles\/global\.css["']|import ["']\.\/styles\/global\.css["']/);
  assert.doesNotMatch(main, /import ["']\.\/styles\.css["']/);
});

test("styles/global.css exposes shared primitives", () => {
  const css = readFileSync(resolve("src/styles/global.css"), "utf8");
  for (const token of [":root", ".button-primary", ".modal-backdrop", ".form-error", ".status-pill", ".brand-lockup", ".settings-notice", "@keyframes spin"]) {
    assert.equal(css.includes(token), true, token);
  }
});

test("App loads App.module.css and keeps app-shell class", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /import styles from ["']\.\/App\.module\.css["']/);
  assert.match(app, /app-shell/);
  assert.match(app, /styles\.root/);
});

test("App.module.css owns shell chrome via :global(.selector)", () => {
  const css = readFileSync(resolve("src/App.module.css"), "utf8");
  assert.equal(/^:global\s*\{/m.test(css), false);
  for (const token of [":global(.app-shell)", ":global(.workspace)", ":global(.project-tabs)", ":global(.content-toolbar)", ":global(.automations-hidden)", ":global(.toast)", ":global(.loading-screen)"]) {
    assert.equal(css.includes(token), true, token);
  }
});

test("SettingsPage module owns settings-section rules", () => {
  const css = readFileSync(resolve("src/pages/SettingsPage/SettingsPage.module.css"), "utf8");
  assert.match(css, /:global\(\.settings-section\)/);
  assert.match(css, /:global\(\.settings-section-heading\)/);
});

test("AgentOpsPage module owns ops-badge and stuck-summary rules", () => {
  const css = readFileSync(resolve("src/pages/AgentOpsPage/AgentOpsPage.module.css"), "utf8");
  assert.match(css, /:global\(\.ops-badge\)/);
  assert.match(css, /:global\(\.stuck-summary\)/);
  assert.match(css, /:global\(\.ops-task-key\)/);
});

test("root styles.css is removed", () => {
  assert.equal(existsSync(resolve("src/styles.css")), false);
});

test("styles/global.css does not contain App or page-exclusive selectors", () => {
  const css = readFileSync(resolve("src/styles/global.css"), "utf8");
  for (const selector of [
    ".app-shell",
    ".workspace ",
    ".project-tabs",
    ".content-toolbar",
    ".automations-hidden",
    ".toast",
    ".loading-screen",
    ".settings-section",
    ".ops-badge",
    ".stuck-summary",
    ".workspace-switch",
    ".empty-project",
  ]) {
    assert.equal(css.includes(selector.trimEnd()), false, selector);
  }
});
