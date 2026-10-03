# Global stylesheet retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire monolithic `apps/web/src/styles.css` by splitting shared primitives into `styles/global.css` and App/page-owned rules into CSS Modules, without product behavior changes.

**Architecture:** Follow Approach A and the approved slice 6 design. One PR. Plain `styles/global.css` for reset/tokens/shared primitives. `App.module.css` owns shell/toolbar/toast/loading via Vite-safe `:global(.selector)` rules. Settings/AgentOps absorb exclusive leftovers. Delete dead unused rules and remove `styles.css`.

**Tech Stack:** React 19, Vite 6 (`*.module.css`), TypeScript, Node test runner (`tsx --test`)

**Spec:** `docs/superpowers/specs/2026-10-03-web-styles-globals-retirement-design.md`

## Global Constraints

- No intentional product behavior changes
- Do not extract ModalShell; keep string `className="button"` / `modal-backdrop` call sites
- Never use Sass-style block `:global { … }` — Vite drops it; use `:global(.selector)` per rule
- Media queries must wrap `:global(.…)` rules: `@media (…) { :global(.x) { … } }`
- Dual-class hooks stay as strings in TSX (`automations-hidden`, toolbar/mobile `open`, etc.)
- Keep `@keyframes spin` in `styles/global.css` (shared by loading-mark and AgentOps refresh)
- Keep `.settings-notice` in `styles/global.css` (SettingsPage + ProjectMembersModal)
- PRs targeting `main` must bump root version `0.1.27` → `0.1.28` in `package.json` + `package-lock.json`
- `docs/` is gitignored — force-add spec/plan in the final commit (`git add -f`)
- Verify every task with the commands listed in that task

## Review Focus

- After `main.tsx` switches imports, buttons/modals/status pills still styled app-wide
- App shell layout (workspace margin, project tabs, toolbar filters, mobile topbar) still matches current breakpoints
- `automations-hidden` still hides content-area when Automations view is active
- Settings members notice and ProjectMembersModal notice still share `.settings-notice` styling
- AgentOps stuck/active/idle badges and stuck summary still render with correct colors
- Toast and loading-screen still appear during App flash/load paths

## File map (end state)

```
apps/web/src/
  main.tsx                 # import "./styles/global.css"
  App.tsx                  # import App.module.css; root class includes styles.root
  App.module.css
  styles/
    global.css
  pages/SettingsPage/SettingsPage.module.css   # + settings-section*
  pages/AgentOpsPage/AgentOpsPage.module.css   # + ops-badge* / stuck-summary
```

Delete: `apps/web/src/styles.css`  
Test file: `apps/web/test/stylesGlobalsExport.test.ts` (create in Task 1, extend each task)

---

### Task 1: Create `styles/global.css` and rewire `main.tsx`

**Files:**
- Create: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/main.tsx` — `import "./styles/global.css"`
- Keep temporarily: `apps/web/src/styles.css` (still contains App/page rules until later tasks remove them; after this task it must NOT still be imported)
- Test: `apps/web/test/stylesGlobalsExport.test.ts` (create)

**Interfaces:**
- Consumes: none
- Produces: plain global stylesheet loaded once from `main.tsx`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='styles/global|main imports styles'`
Expected: FAIL (missing file / old import)

- [ ] **Step 3: Implement globals + rewire**

1. Create `apps/web/src/styles/global.css` containing, copied from current `styles.css`:
   - `:root { … }`
   - reset (`*`, `body`, `button`/`input`/`textarea`/`select`, `svg`)
   - `html[data-text-size="large"] body { zoom: 1.08; }`
   - brand: `.brand-lockup`, `.brand-lockup-light`, `.brand-mark` (+ svg)
   - buttons: `.button`, `.button-primary`, `.button-secondary`, `.button-danger-quiet`, `.button-project-delete`, `.button-delete` (base rules only; mobile size override stays App-owned)
   - status/priority/tone/PR: `.status-dot*`, `.task-key`, `.priority*`, `.pr-*`, `.status-pill`, `.tone-*`, `.muted`
   - modal primitives: `.modal-backdrop`, `@keyframes modal-in`, `.modal-kicker`, `.icon-button*`, `.section-heading*`, `.form-error`, `.form-success`
   - `.settings-notice` (+ nested svg/span/strong/small)
   - `@keyframes spin`
2. Update `main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

3. Leave App/page-exclusive rules in `styles.css` for now, but ensure nothing imports `styles.css`.

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='styles/global|main imports styles'`
Expected: PASS

Also run: `npm run typecheck -w @taskforge/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/global.css apps/web/src/main.tsx apps/web/test/stylesGlobalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): introduce styles/global.css for shared primitives

Load reset, tokens, and shared button/modal/status classes from a dedicated globals entry.
EOF
)"
```

---

### Task 2: Move App chrome into `App.module.css`

**Files:**
- Create: `apps/web/src/App.module.css`
- Modify: `apps/web/src/App.tsx` — import module; root `className={\`app-shell ${styles.root}\`}`
- Modify: `apps/web/src/styles.css` — remove App-owned rules moved here
- Test: extend `stylesGlobalsExport.test.ts`

**Interfaces:**
- Consumes: existing App JSX class strings unchanged
- Produces: `App.module.css` emitting global selectors via `:global(.…)`

- [ ] **Step 1: Extend failing tests**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='App loads App|App.module.css owns'`
Expected: FAIL

- [ ] **Step 3: Implement App module**

1. Create `App.module.css`:

```css
.root {
  /* ownership hook so the module always loads with App */
}

:global(.automations-hidden) { display: none; }
:global(.app-shell) { height: 100vh; height: 100dvh; display: flex; overflow: hidden; background: #f7f8fa; }
/* … copy remaining App-owned rules from styles.css, wrapping every selector in :global(...) … */
```

Move these from `styles.css` (exact declarations as today):
- `.automations-hidden`
- `.app-shell`
- `.mobile-nav-scrim`, `.mobile-topbar` (+ all mobile-topbar descendants)
- `.workspace`
- `.project-header`, `.breadcrumbs*`, `.project-title-row*`, `.project-logo`, `.header-actions`
- `.mobile-notification-button`, `.mobile-search-button`, `.mobile-settings-button`
- `.project-tabs` (+ button/a/active/svg)
- `.content-toolbar`, `.search-field*`, `.toolbar-spacer`, `.select-wrap*`, `.task-total`
- `.estimate-filter*`, `.estimate-unestimated*`, `.clear-filters`, `.toolbar-filters`, `.mobile-filter-toggle*`
- `.content-area`
- `.toast`, `@keyframes toast-in`
- `.loading-screen`, `.loading-mark`
- `@media (max-width: 900px)` App pieces: `.workspace` margin, `.project-title-row p` (do **not** keep deleted workspace-switch rules)
- `@media (max-width: 650px)` App pieces listed in current file for workspace/header/tabs/toolbar/mobile buttons/content-area; include `.button-project-delete` mobile override here; keep `.modal-backdrop { padding: 10px; }` in this media block (App owns the responsive backdrop padding) **or** move that one line into `styles/global.css` under the same media query — prefer App module to avoid splitting modal primitives further

2. Update `App.tsx`:

```tsx
import styles from "./App.module.css";
// ...
return (
  <div className={`app-shell ${styles.root}`}>
```

Also apply `styles.root` on the loading-screen early return so chrome CSS loads before auth finishes:

```tsx
if (loading) return <div className={`loading-screen ${styles.root}`}><span className="loading-mark" />Loading your workspace…</div>;
```

3. Remove the moved selectors from `styles.css`.

- [ ] **Step 4: Run tests + typecheck + build sanity**

```bash
npm run test -w @taskforge/web -- --test-name-pattern='App loads App|App.module.css owns|styles/global|main imports'
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```

Expected: PASS; bundled CSS contains `.app-shell` and `.button-primary`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.module.css apps/web/src/styles.css apps/web/test/stylesGlobalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): move App chrome styles into App.module.css

Own shell, toolbar, toast, and loading rules in the App unit via :global(.selector).
EOF
)"
```

---

### Task 3: Move Settings and AgentOps leftovers into page modules

**Files:**
- Modify: `apps/web/src/pages/SettingsPage/SettingsPage.module.css`
- Modify: `apps/web/src/pages/AgentOpsPage/AgentOpsPage.module.css`
- Modify: `apps/web/src/styles.css` — remove moved leftovers
- Test: extend `stylesGlobalsExport.test.ts`

**Interfaces:**
- Consumes: existing page class strings
- Produces: page modules emitting `:global(.settings-section*)` / `:global(.ops-*)`

- [ ] **Step 1: Extend failing tests**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='SettingsPage module owns|AgentOpsPage module owns'`
Expected: FAIL

- [ ] **Step 3: Implement page leftovers**

Append to `SettingsPage.module.css` (Vite-safe form):

```css
:global(.settings-section) { background: white; border: 1px solid #dfe1e6; border-radius: 10px; box-shadow: 0 2px 5px rgba(9,30,66,.04); overflow: hidden; }
:global(.settings-section-heading) { padding: 22px 24px 18px; border-bottom: 1px solid #ebecf0; }
:global(.settings-section-heading h2) { margin: 0 0 5px; font-size: 19px; }
:global(.settings-section-heading p) { margin: 0; color: #6b778c; font-size: 12px; }
```

Append to `AgentOpsPage.module.css`:

```css
:global(.stuck-summary) { display: flex; align-items: center; gap: 6px; color: #bf2600; font-size: 14px; }
:global(.stuck-summary svg) { width: 15px; }
:global(.ops-badge) { display: flex; align-items: center; gap: 5px; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }
:global(.ops-badge svg) { width: 13px; }
:global(.ops-badge-stuck) { background: #ffebe6; color: #bf2600; }
:global(.ops-badge-active) { background: #e3fcef; color: #006644; }
:global(.ops-badge-idle) { background: #f1f3f5; color: #7a869a; }
:global(.ops-task-key) { font-size: 12px; font-weight: 700; color: #6554c0; white-space: nowrap; }
:global(.ops-task-title) { font-size: 13px; color: #253858; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
```

Remove those selectors from `styles.css`. Keep `.settings-notice` in `styles/global.css`.

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='SettingsPage module owns|AgentOpsPage module owns|App.module.css owns|styles/global'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage/SettingsPage.module.css apps/web/src/pages/AgentOpsPage/AgentOpsPage.module.css apps/web/src/styles.css apps/web/test/stylesGlobalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): move settings and agent-ops leftover CSS into page modules

Clear page-exclusive rules from the shrinking global stylesheet.
EOF
)"
```

---

### Task 4: Delete dead rules + remove `styles.css`; purge tests; version bump; force-add docs

**Files:**
- Delete: `apps/web/src/styles.css`
- Modify: `apps/web/test/stylesGlobalsExport.test.ts` — purge/absence assertions
- Modify: `package.json`, `package-lock.json` — `0.1.27` → `0.1.28`
- Force-add: design spec + this plan under `docs/superpowers/`

**Interfaces:** none

- [ ] **Step 1: Add purge assertions**

```ts
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
```

- [ ] **Step 2: Run purge test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='root styles.css is removed|does not contain App'`
Expected: FAIL until deletion complete

- [ ] **Step 3: Purge + bump + docs**

1. Confirm `styles.css` only has dead rules / empty leftovers; delete unused `.workspace-switch*`, `.workspace-icon`, `.empty-project` if still present
2. Delete `apps/web/src/styles.css`
3. Bump root version `0.1.27` → `0.1.28` in `package.json` and `package-lock.json` (`version` and `packages[""].version`)
4. Force-add docs:

```bash
git add -f docs/superpowers/specs/2026-10-03-web-styles-globals-retirement-design.md \
  docs/superpowers/plans/2026-10-03-web-styles-globals-retirement.md
```

- [ ] **Step 4: Full verification**

```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```

Expected: PASS. Bundled CSS includes `.button-primary`, `.app-shell`, `.project-tabs`, `.ops-badge`, `.settings-section`.

Manual checklist:
- [ ] Login + brand lockup
- [ ] Sidebar / mobile topbar / workspace margins at 900 and 650
- [ ] Board/list toolbar filters + mobile filter toggle
- [ ] Settings section + notice; Project members notice
- [ ] Agent ops badges / stuck summary
- [ ] Toast flash + loading screen
- [ ] Modal backdrop / buttons

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/src/styles apps/web/src/App.module.css apps/web/src/App.tsx apps/web/src/main.tsx apps/web/src/pages apps/web/test/stylesGlobalsExport.test.ts package.json package-lock.json
git add -f docs/superpowers/specs/2026-10-03-web-styles-globals-retirement-design.md docs/superpowers/plans/2026-10-03-web-styles-globals-retirement.md
git commit -m "$(cat <<'EOF'
refactor(web): retire monolithic styles.css

Split shared primitives into styles/global.css, move App/page leftovers into modules, and bump the release version.
EOF
)"
```

---

## Self-review notes

- Spec coverage: globals entry, App module, Settings/AgentOps leftovers, dead-rule deletion, `styles.css` removal, `:global(.selector)` constraint, dual-class hooks, version bump, docs, verification — Tasks 1–4
- Placeholder scan: none
- Type consistency: plain CSS globals + App.module.css `styles.root` hook; no ModalShell
- Review Focus pinned across Tasks 1–3 (shared primitives load, App chrome breakpoints/hooks, shared settings-notice, ops badges)
- Out of scope preserved: ModalShell, call-site rewrite of button/status classes
