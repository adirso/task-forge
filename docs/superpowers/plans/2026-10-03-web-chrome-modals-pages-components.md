# Remaining chrome, modals & pages migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate remaining Login/Phases/Automations/AgentOps pages plus shell chrome and project/phase/logout modals into folder units with CSS Modules, without changing product behavior.

**Architecture:** Follow Approach A and the approved slice design. One PR. Pages under `pages/`; shell and modals under `components/<Name>/`. Shared `.button*`, `.modal-backdrop`, `.modal-kicker`, `.form-error`/`.form-success`, brand/eyebrow tokens, status/priority, and App-owned tabs/toolbar/content-area stay global until slice 6. App keeps orchestration; Settings updates its `AgentOpsPage` import.

**Tech Stack:** React 19, Vite 6 (`*.module.css`), TypeScript, Node test runner (`tsx --test`), `@taskforge/contracts`

**Spec:** `docs/superpowers/specs/2026-10-03-web-chrome-modals-pages-components-design.md`

## Global Constraints

- No intentional product behavior changes
- CSS Modules only for migrated units; no new feature rules in root `styles.css` except unavoidable temporary dual-class hooks
- Public exports: `Login`, `PhasesPage`, `AutomationsPage` (rename from `AutomationManager`), `AgentOpsPage`, plus unchanged shell/modal export names
- `parts/` only when ownership is clearer; default is one unit per surface
- Keep global: `.button*`, `.modal-backdrop`, `.modal-kicker`, `.form-error`, `.form-success`, `.brand-lockup*`, `.brand-mark`, `.eyebrow` (shared Login/Automations/Sidebar), status/priority tokens, App shell (`.project-tabs`, `.content-area`, `.toolbar*`, `.automations-hidden`, `.dashboard-hidden`, mobile nav owned by App)
- Sidebar must keep accepting optional `className` / `onNavigate`; App continues applying `mobile-sidebar` / `mobile-open` strings (dual-class on root as needed)
- Do not extract a new ModalShell
- PRs targeting `main` must bump root version `0.1.26` → `0.1.27` in `package.json` + `package-lock.json`
- Verify every task with the commands listed in that task
- `docs/` is gitignored — force-add spec/plan in the final commit (`git add -f`)

## Review Focus

- Login still submits demo credentials and surfaces `form-error` on failure
- Phases page `onChange` still propagates phase mutations / delete / task-reassign actions to App
- Automations page rename: App renders `<AutomationsPage />` and `automations-hidden` content-area toggle still works
- AgentOps from Settings still calls `onOpenAgent` and navigates to agents tab
- Sidebar mobile drawer still receives App’s `mobile-sidebar` / `mobile-open` classes and `onNavigate` closes the drawer
- Modal open/close and primary actions (create project, members, delete, phase delete/merge, logout) still wired from App unchanged

## File map (end state)

```
apps/web/src/
  App.tsx
  styles.css
  pages/
    Login/
    PhasesPage/
    AutomationsPage/
    AgentOpsPage/
  components/
    Sidebar/
    Avatar/
    NotificationPanel/
    SearchPalette/
    MultiFilterDropdown/
    ProjectHeaderActions/
    ProjectModal/
    ProjectMembersModal/
    ProjectDeleteModal/
    PhaseDeleteModal/
    PhaseMergeModal/
    LogoutConfirmModal/
```

Delete flat sources under `components/` for each migrated unit. Test file: `apps/web/test/chromeModalsExport.test.ts` (created in Task 1, extended each task).

---

### Task 1: Migrate Login to pages/Login

**Files:**
- Create: `apps/web/src/pages/Login/{Login.tsx,Login.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — `from "./pages/Login"`
- Modify: `apps/web/src/styles.css` — move `.login-*`, `.demo-hint`, `.mobile-brand` (login-only); leave `.button*`, `.form-error`, `.brand-*`, `.eyebrow` global
- Delete: `apps/web/src/components/Login.tsx`
- Test: `apps/web/test/chromeModalsExport.test.ts` (create)

**Interfaces:**
- Consumes: `onLogin: (email: string, password: string) => Promise<void>`
- Produces: `export function Login(props: LoginProps): JSX.Element`

- [ ] **Step 1: Add structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='Login'`
Expected: FAIL

- [ ] **Step 3: Implement Login page unit**

1. Create types + index
2. Move TSX; map login-owned classes to the module; keep global `button`, `form-error`, `brand-lockup`, `brand-mark`, `eyebrow`
3. Update App import; delete flat file; remove migrated selectors from `styles.css` (including login mobile rules)

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='Login'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Login apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate Login to pages with CSS Modules

Move the login surface under pages/Login and rewire App imports.
EOF
)"
```

---

### Task 2: Migrate PhasesPage

**Files:**
- Create: `apps/web/src/pages/PhasesPage/{PhasesPage.tsx,PhasesPage.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — `from "./pages/PhasesPage"`
- Modify: `apps/web/src/styles.css` — move `.phases-*`, phase list/page layout owned by Phases (not PhaseDelete/Merge modals); leave board `PhaseBanner` alone (already migrated)
- Delete: `apps/web/src/components/PhaseManager.tsx`
- Test: extend `chromeModalsExport.test.ts`

**Interfaces:**
- Consumes: current `PhasesPage` props `{ project, phases, onChange }`
- Produces: `export function PhasesPage(props: PhasesPageProps): JSX.Element`

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='PhasesPage'`
Expected: FAIL

- [ ] **Step 3: Implement PhasesPage**

Move implementation + CSS; preserve `onChange` payload shape exactly; update App; delete `PhaseManager.tsx`; purge page CSS (keep phase-delete/merge modal CSS for Task 6).

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='PhasesPage|Login'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PhasesPage apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate PhasesPage to pages with CSS Modules

Move phases management under pages/PhasesPage and drop PhaseManager.tsx.
EOF
)"
```

---

### Task 3: Migrate AutomationsPage (rename AutomationManager)

**Files:**
- Create: `apps/web/src/pages/AutomationsPage/{AutomationsPage.tsx,AutomationsPage.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — import `AutomationsPage`; JSX `<AutomationsPage ... />`
- Modify: `apps/web/src/styles.css` — move `.automation-*` page/builder/list rules; keep `.automations-hidden` global (App content-area toggle)
- Delete: `apps/web/src/components/AutomationManager.tsx`
- Test: extend `chromeModalsExport.test.ts`

**Interfaces:**
- Consumes: `{ project: Project | null; users: User[]; phases?: Phase[] }`
- Produces: `export function AutomationsPage(props: AutomationsPageProps): JSX.Element`

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AutomationsPage'`
Expected: FAIL

- [ ] **Step 3: Implement AutomationsPage**

Rename export to `AutomationsPage`; move CSS; keep using global `.button*`, `.eyebrow` if present; App JSX rename; delete flat file; purge automation selectors except `.automations-hidden`.

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AutomationsPage|PhasesPage|Login'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AutomationsPage apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate AutomationsPage to pages with CSS Modules

Rename AutomationManager to AutomationsPage under pages/ and rewire App.
EOF
)"
```

---

### Task 4: Migrate AgentOpsPage

**Files:**
- Create: `apps/web/src/pages/AgentOpsPage/{AgentOpsPage.tsx,AgentOpsPage.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/pages/SettingsPage/SettingsPage.tsx` — import from `../../pages/AgentOpsPage` (or relative equivalent)
- Modify: `apps/web/src/styles.css` — move `.agent-ops*`
- Delete: `apps/web/src/components/AgentOpsPage.tsx`
- Test: extend `chromeModalsExport.test.ts`

**Interfaces:**
- Consumes: `{ onOpenAgent?: (agentId: string) => void }`
- Produces: `export function AgentOpsPage(props: AgentOpsPageProps): JSX.Element`

- [ ] **Step 1: Extend structure test**

```ts
test("Settings imports AgentOpsPage from pages/AgentOpsPage", () => {
  const settings = readFileSync(resolve("src/pages/SettingsPage/SettingsPage.tsx"), "utf8");
  assert.match(settings, /from ["'].*pages\/AgentOpsPage["']/);
  assert.doesNotMatch(settings, /from ["'].*components\/AgentOpsPage["']/);
});

test("AgentOpsPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/AgentOpsPage");
  for (const file of ["index.ts", "AgentOpsPage.tsx", "AgentOpsPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AgentOpsPage'`
Expected: FAIL

- [ ] **Step 3: Implement AgentOpsPage**

Move unit + CSS; update Settings import; delete flat file; purge `.agent-ops*` from `styles.css`.

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AgentOpsPage|AutomationsPage|settingsPage|Login'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AgentOpsPage apps/web/src/pages/SettingsPage apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate AgentOpsPage to pages with CSS Modules

Move agent ops under pages/ and update Settings to import the page unit.
EOF
)"
```

---

### Task 5: Folderize shell chrome (Sidebar, Avatar, NotificationPanel, SearchPalette, MultiFilterDropdown, ProjectHeaderActions)

**Files:**
- Create folder units under `apps/web/src/components/<Name>/` for each of the six
- Modify: `App.tsx` and any internal imports (Sidebar→Avatar, header actions, etc.)
- Modify: `styles.css` — move shell-owned selectors (`.sidebar*`, `.main-nav`, `.project-nav`, `.nav-section-title`, `.profile-button`, `.project-glyph`, `.avatar*` size variants used by Avatar, `.notification-*`, `.search-backdrop`, `.search-palette*`, `.search-field*` if owned by header/search, `.multi-filter*`, project header action selectors exclusive to `ProjectHeaderActions`)
- Keep App-owned: `.project-header` layout shell if still wrapping tabs/toolbar in App; inspect before moving
- Delete flat `*.tsx` for each
- Test: extend `chromeModalsExport.test.ts`

**Interfaces:**
- Preserve existing prop contracts exactly (especially Sidebar’s optional `className` / `onNavigate`)
- Sidebar root: `className={\`${styles.sidebar}${className ? \` \${className}\` : ""}\`}` so App’s `mobile-sidebar` / `mobile-open` keep working
- Avatar stays a top-level component; update import paths in Sidebar, widgets, modals as needed

- [ ] **Step 1: Extend structure test**

```ts
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
    assert.match(app, new RegExp(`from ["']\\.\\/components\\/${name}["']`));
    assert.doesNotMatch(app, new RegExp(`from ["']\\.\\/components\\/${name}\\.tsx["']`));
  }
});

test("Sidebar keeps mobile className hook", () => {
  const tsx = readFileSync(resolve("src/components/Sidebar/Sidebar.tsx"), "utf8");
  assert.match(tsx, /className/);
  assert.match(readFileSync(resolve("src/App.tsx"), "utf8"), /mobile-sidebar/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='shell chrome|Sidebar keeps mobile'`
Expected: FAIL

- [ ] **Step 3: Implement all six shell units**

For each: create folder, move CSS, update imports, delete flat file. Prefer implementing Avatar first (dependency), then Sidebar, then the rest. Move related mobile media fragments with each unit.

- [ ] **Step 4: Run tests + typecheck**

Run:
```bash
npm run test -w @taskforge/web -- --test-name-pattern='shell chrome|Sidebar|Login|PhasesPage|AutomationsPage|AgentOpsPage'
npm run typecheck -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar apps/web/src/components/Avatar apps/web/src/components/NotificationPanel apps/web/src/components/SearchPalette apps/web/src/components/MultiFilterDropdown apps/web/src/components/ProjectHeaderActions apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts apps/web/src/pages apps/web/src/components/widgets
git commit -m "$(cat <<'EOF'
refactor(web): folderize shell chrome with CSS Modules

Move sidebar, avatar, search, notifications, filters, and header actions into component units.
EOF
)"
```

---

### Task 6: Folderize modals (Project*, Phase*, LogoutConfirm)

**Files:**
- Create folder units for: `ProjectModal`, `ProjectMembersModal`, `ProjectDeleteModal`, `PhaseDeleteModal`, `PhaseMergeModal`, `LogoutConfirmModal`
- Modify: `App.tsx` imports; any cross-imports between modals
- Modify: `styles.css` — move `.project-modal*`, members modal / `.project-member*`, `.phase-merge-*`, `.phase-delete-*`, `.phase-modal*` if delete uses it, `.logout-*`; keep `.modal-backdrop`, `.modal-kicker`, `.button*`
- Delete flat modal `*.tsx`
- Test: extend `chromeModalsExport.test.ts`

**Interfaces:**
- Preserve each modal’s existing props/callbacks exactly

- [ ] **Step 1: Extend structure test**

```ts
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
    assert.match(app, new RegExp(`from ["']\\.\\/components\\/${name}["']`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='modal units'`
Expected: FAIL

- [ ] **Step 3: Implement all six modal units**

Move each modal + CSS; keep backdrop/button globals; update App; delete flats; move related mobile fragments.

- [ ] **Step 4: Run tests + typecheck**

Run:
```bash
npm run test -w @taskforge/web -- --test-name-pattern='modal units|shell chrome|Login|PhasesPage|AutomationsPage|AgentOpsPage'
npm run typecheck -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ProjectModal apps/web/src/components/ProjectMembersModal apps/web/src/components/ProjectDeleteModal apps/web/src/components/PhaseDeleteModal apps/web/src/components/PhaseMergeModal apps/web/src/components/LogoutConfirmModal apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): folderize project and phase modals with CSS Modules

Move remaining modals into component units and clear their global stylesheet rules.
EOF
)"
```

---

### Task 7: Purge leftovers; version bump; force-add docs

**Files:**
- Modify: `apps/web/src/styles.css` — remove any remaining migrated selectors/media fragments
- Modify: `package.json`, `package-lock.json` — `0.1.26` → `0.1.27`
- Modify: `apps/web/test/chromeModalsExport.test.ts` — purge assertion
- Force-add: design spec + this plan under `docs/superpowers/`

**Interfaces:** none

- [ ] **Step 1: Add purge assertion**

```ts
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
```

Note: assert carefully — prefer exact prefixes that won’t false-positive on kept globals. If `.sidebar` appears only as a comment, adjust. Dual-class hooks in TSX are fine; CSS rules must be gone.

- [ ] **Step 2: Run purge test**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='legacy chrome/modal/page selectors'`
Expected: FAIL until purge complete, then PASS

- [ ] **Step 3: Purge + bump + docs**

1. Finish CSS purge; confirm kept globals remain (`.button`, `.modal-backdrop`, `.brand-lockup`, `.automations-hidden`, `.content-area`, `.project-tabs`)
2. Bump version to `0.1.27`
3. `git add -f docs/superpowers/specs/2026-10-03-web-chrome-modals-pages-components-design.md docs/superpowers/plans/2026-10-03-web-chrome-modals-pages-components.md`

- [ ] **Step 4: Full verification**

```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual checklist:
- [ ] Login
- [ ] Sidebar / mobile nav / search / notifications
- [ ] Phases CRUD path
- [ ] Automations builder
- [ ] Agent ops from Settings
- [ ] Project create/edit/members/delete
- [ ] Phase delete/merge
- [ ] Logout confirm

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/test/chromeModalsExport.test.ts package.json package-lock.json
git add -f docs/superpowers/specs/2026-10-03-web-chrome-modals-pages-components-design.md docs/superpowers/plans/2026-10-03-web-chrome-modals-pages-components.md
git commit -m "$(cat <<'EOF'
refactor(web): finish chrome/modals CSS Modules migration

Purge leftover selectors, bump the release version, and add the slice spec/plan.
EOF
)"
```

---

## Self-review notes

- Spec coverage: Login, PhasesPage, AutomationsPage rename, AgentOpsPage + Settings import, six shell units, six modals, CSS split, App wiring, verification, version bump, docs — Tasks 1–7
- Placeholder scan: none
- Type consistency: `AutomationsPage` export name used in App tests; `PhasesPage` path no longer `PhaseManager`; Sidebar `className` preserved
- Review Focus pinned across Tasks 1–6 (login error, phases onChange, automations rename + hidden toggle, Settings agent ops, mobile sidebar classes, modal App wiring)
- Out of scope preserved: ModalShell extraction, final `styles.css` retirement (slice 6), App tabs/toolbar ownership
