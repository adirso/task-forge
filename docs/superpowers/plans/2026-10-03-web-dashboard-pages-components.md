# Dashboard & widgets migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate personal and project dashboards into `pages/` with CSS Modules, and folderize `ModularDashboard`, `WidgetShell`, and each widget, without changing product behavior.

**Architecture:** Follow Approach A and the approved slice design. `DashboardPage` and `ProjectDashboardPage` own page shells; project-only chrome lives in `ProjectDashboardPage/parts/`. Shared grid toolkit stays top-level: `ModularDashboard`, `WidgetShell`, `widgets/*`. App only rewires imports. `lib/` stays logic-only (type import path for `ModuleLayout` may update).

**Tech Stack:** React 19, Vite 6 (`*.module.css`), TypeScript, `react-grid-layout`, Node test runner (`tsx --test`), `@taskforge/contracts`

**Spec:** `docs/superpowers/specs/2026-10-03-web-dashboard-pages-components-design.md`

## Global Constraints

- No intentional product behavior changes (layout persistence, catalog, add/remove/reset, drag/resize, mobile list, project metrics/remount-by-id)
- CSS Modules only for migrated units; no new dashboard/widget rules in root `styles.css`
- Public exports: `DashboardPage`, `ProjectDashboardPage`, `ModularDashboard`, `ModuleLayout`, `WidgetShell`, `WidgetError`, plus existing widget export names
- `parts/` are private to `ProjectDashboardPage`; do not import them from App or sibling pages
- Shared helpers stay in `src/lib/` (no JSX/CSS there)
- Keep global shared primitives still used elsewhere: `.button*`, `.modal-kicker`, status/priority/avatar tokens
- Preserve `react-grid-layout` drag via stable global class `widget-drag-handle` on the shell header
- Do not migrate Phases, Automations, AgentOps page, filter toolbar, or modals in this PR
- PRs targeting `main` must bump root `package.json` + `package-lock.json` version (`0.1.25` → `0.1.26`)
- Verify every task with the commands listed in that task

## Review Focus

- Personal dashboard still loads/saves layout with the same `localStorage` keys and admin vs member defaults (`agent_ops` for admins)
- Grid drag still requires the global `widget-drag-handle` class; reset confirm + add/remove widgets persist
- Mobile breakpoint (`width < 700`) still swaps grid for the stacked list and hides desktop grid/background
- Project dashboard remounts on `project.id` so late responses cannot cross projects; refresh reloads tasks/phases
- Project modular composition (min-heights / widget-body overflow / mobile FAB) still matches today’s visual layout after `:global` composition moves into the page module

## File map (end state for this PR)

```
apps/web/src/
  App.tsx
  styles.css
  pages/
    DashboardPage/{DashboardPage.tsx,DashboardPage.module.css,types.ts,index.ts}
    ProjectDashboardPage/
      ProjectDashboardPage.tsx
      ProjectDashboardPage.module.css
      types.ts
      index.ts
      parts/
        ProjectBars/{ProjectBars.tsx,ProjectBars.module.css,types.ts,index.ts}
        ProjectModuleContent/{ProjectModuleContent.tsx,ProjectModuleContent.module.css,types.ts,index.ts}
  components/
    ModularDashboard/{ModularDashboard.tsx,ModularDashboard.module.css,types.ts,index.ts}
    WidgetShell/{WidgetShell.tsx,WidgetShell.module.css,types.ts,index.ts}
    widgets/
      ProjectStatusWidget/
      ProjectProgressWidget/
      ProjectTimeWidget/
      MyTasksWidget/
      StuckTasksWidget/
      ActivityWidget/
      AgentOpsWidget/
  lib/dashboard.ts
  lib/projectDashboard.ts          # ModuleLayout import path update only
  lib/widgetQuery.ts
```

Delete flat: `components/DashboardPage.tsx`, `components/ProjectDashboard.tsx`, `components/ModularDashboard.tsx`, `components/WidgetShell.tsx`, `components/widgets/*.tsx`

---

### Task 1: Folderize WidgetShell with CSS Modules + shared widget states

**Files:**
- Create: `apps/web/src/components/WidgetShell/{WidgetShell.tsx,WidgetShell.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/components/ModularDashboard.tsx` import → `./WidgetShell`
- Modify: `apps/web/src/components/widgets/*.tsx` and `ProjectDashboard.tsx` — import `WidgetError` / shared loading+empty helpers from `../WidgetShell` (or `./WidgetShell`)
- Modify: `apps/web/src/styles.css` — move WidgetShell-owned rules into the module
- Delete: `apps/web/src/components/WidgetShell.tsx`
- Test: `apps/web/test/dashboardExport.test.ts` (create)

**Interfaces:**
- Consumes: existing `WidgetShell` props `{ type?: WidgetType; title?: string; icon: React.ReactNode; children: React.ReactNode; onClose: () => void }` and `WidgetError` props `{ message: string; onRetry: () => void }`
- Produces:
  - `export function WidgetShell(props: WidgetShellProps): JSX.Element`
  - `export function WidgetError(props: WidgetErrorProps): JSX.Element`
  - `export function WidgetLoading(props?: { lines?: number }): JSX.Element`
  - `export function WidgetEmpty(props: { children: React.ReactNode }): JSX.Element`
- Header element MUST keep global class `widget-drag-handle` (in addition to the module class) for `ModularDashboard` `dragConfig.handle`

- [ ] **Step 1: Add structure test**

Create `apps/web/test/dashboardExport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("WidgetShell is a folder unit with drag-handle hook", () => {
  const index = readFileSync(resolve("src/components/WidgetShell/index.ts"), "utf8");
  assert.match(index, /export \{ WidgetShell/);
  assert.match(index, /WidgetError/);
  const tsx = readFileSync(resolve("src/components/WidgetShell/WidgetShell.tsx"), "utf8");
  assert.match(tsx, /widget-drag-handle/);
  for (const file of ["WidgetShell.tsx", "WidgetShell.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve("src/components/WidgetShell", file), "utf8").length > 0, true, file);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='WidgetShell is a folder'`
Expected: FAIL (folder missing)

- [ ] **Step 3: Implement WidgetShell unit**

1. Create `types.ts` with `WidgetShellProps` / `WidgetErrorProps`
2. Move implementation; map card/header/body/error/retry classes to the module
3. Add `WidgetLoading` / `WidgetEmpty` using module classes (move `.widget-loading`, `.widget-skeleton*`, `@keyframes shimmer`, `.widget-empty` here)
4. On the drag header: `className={`${styles.dragHandle} widget-drag-handle`}`
5. Update imports in ModularDashboard, widgets, ProjectDashboard
6. Replace `className="widget-loading"...` / `className="widget-empty"...` call sites with `<WidgetLoading />` / `<WidgetEmpty>...</WidgetEmpty>` (preserve skeleton line counts: mostly 3, StuckTasks/AgentOps use 2)
7. Delete flat `WidgetShell.tsx`
8. Remove migrated selectors from `styles.css`

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='WidgetShell is a folder|widgetQuery|dashboard'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WidgetShell apps/web/src/components/ModularDashboard.tsx apps/web/src/components/widgets apps/web/src/components/ProjectDashboard.tsx apps/web/src/styles.css apps/web/test/dashboardExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): folderize WidgetShell with CSS Modules

Move widget card chrome and shared loading/empty states into a component unit while keeping the grid drag-handle hook.
EOF
)"
```

---

### Task 2: Folderize home widgets with CSS Modules

**Files:**
- Create: `apps/web/src/components/widgets/<Name>/{<Name>.tsx,<Name>.module.css,types.ts,index.ts}` for each of:
  - `ProjectStatusWidget`, `ProjectProgressWidget`, `ProjectTimeWidget`, `MyTasksWidget`, `StuckTasksWidget`, `ActivityWidget`, `AgentOpsWidget`
- Modify: `apps/web/src/components/DashboardPage.tsx` imports → `./widgets/<Name>`
- Modify: `apps/web/src/styles.css` — move each widget’s content selectors into its module
- Delete: flat `apps/web/src/components/widgets/*.tsx`
- Test: `apps/web/test/dashboardExport.test.ts`

**Interfaces:**
- Consumes: existing widget props (only `AgentOpsWidget` takes `{ currentUser: User }`; others take none)
- Produces: same named exports from each `widgets/<Name>/index.ts`
- Import `WidgetError` / `WidgetLoading` / `WidgetEmpty` from `../../WidgetShell`

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='home widgets are folder'`
Expected: FAIL

- [ ] **Step 3: Implement each widget folder**

For each widget:

1. Create folder unit with types + index
2. Move TSX; replace content class strings with `styles.*`
3. Copy matching CSS from `styles.css` (including `wps-*`, `wpp-*`, `wpt-*`, `wtl-*`, `wa-*`, `wao-*` blocks owned by that widget)
4. Keep navigation helpers (`dashboardNav`, `api`, `widgetQuery`) imports working via relative paths (`../../../lib/...`)
5. Delete flat `.tsx`
6. Update `DashboardPage` imports to `./widgets/<Name>`

Shared task-list CSS (`.widget-task-list`, `.wtl-*`) is used by MyTasks + StuckTasks: put the shared rules in `MyTasksWidget.module.css` and import that module from StuckTasks **or** duplicate the small shared block into both modules — prefer importing MyTasks module classes from StuckTasks only if it stays readable; otherwise duplicate the ~12 rules into both modules to avoid cross-widget coupling. Pick one and apply consistently.

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='home widgets|WidgetShell|dashboard'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/widgets apps/web/src/components/DashboardPage.tsx apps/web/src/styles.css apps/web/test/dashboardExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): folderize dashboard widgets with CSS Modules

Give each home widget its own unit and move content styles out of the global stylesheet.
EOF
)"
```

---

### Task 3: Folderize ModularDashboard with CSS Modules; fix ModuleLayout import

**Files:**
- Create: `apps/web/src/components/ModularDashboard/{ModularDashboard.tsx,ModularDashboard.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/lib/projectDashboard.ts` — `import type { ModuleLayout } from "../components/ModularDashboard"`
- Modify: `apps/web/src/components/DashboardPage.tsx` import → `./ModularDashboard`
- Modify: `apps/web/src/components/ProjectDashboard.tsx` import → `./ModularDashboard`
- Modify: `apps/web/src/styles.css` — move ModularDashboard-owned rules (page/canvas/grid/empty/fab/picker/mobile list + react-grid handle/placeholder tweaks)
- Delete: `apps/web/src/components/ModularDashboard.tsx`
- Test: `apps/web/test/dashboardExport.test.ts`

**Interfaces:**
- Consumes: `WidgetShell` from `../WidgetShell`; grid helpers from `../../lib/dashboard`
- Produces:
  - `export interface ModuleLayout<T extends string> { version: 2; widgets: Array<{ id: string; type: T; x: number; y: number; w: number; h: number }> }`
  - `export function ModularDashboard<T extends string>(props: ModularDashboardProps<T>): JSX.Element`
- Keep vendor CSS imports on the ModularDashboard entry
- Keep `dragConfig.handle: ".widget-drag-handle"`
- Root shell should expose a stable global class `dashboard-page` (and canvas/grid hooks as needed) so ProjectDashboardPage composition can target them — apply as `${styles.page} dashboard-page` (same pattern as drag handle)

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='ModularDashboard is a folder|projectDashboard imports ModuleLayout'`
Expected: FAIL

- [ ] **Step 3: Implement ModularDashboard unit**

1. Move `ModuleLayout` + props into `types.ts`; re-export from `index.ts`
2. Move implementation; map dashboard/fab/picker/empty/mobile/grid item classes to the module
3. Keep dual classes for composition hooks: `dashboard-page`, `dashboard-canvas`, `dashboard-grid`, `dashboard-grid-bg`, `dashboard-grid-item`, `dashboard-fab-area`, `widget-picker`, `widget-body` only if still referenced globally by project composition — minimum set required by Task 5 composition is `dashboard-page`, `dashboard-canvas`, and whatever ProjectDashboard currently targets (`.widget-body`, `.dashboard-fab-area`, `.widget-picker`). Prefer dual-class on those elements.
4. Move react-grid placeholder/handle overrides into the module with `:global(.react-grid-item.react-grid-placeholder)` / `:global(.react-resizable-handle*)` as needed
5. Move mobile overrides that only hide grid / restyle FAB/picker into the module `@media (max-width: 700px)`
6. Update consumers + `lib/projectDashboard.ts` import
7. Delete flat file; remove migrated selectors from `styles.css`

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='ModularDashboard|projectDashboard|dashboard'`
Expected: PASS (including existing `projectDashboard.test.ts` / `dashboard.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ModularDashboard apps/web/src/components/DashboardPage.tsx apps/web/src/components/ProjectDashboard.tsx apps/web/src/lib/projectDashboard.ts apps/web/src/styles.css apps/web/test/dashboardExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): folderize ModularDashboard with CSS Modules

Extract the shared grid shell and keep ModuleLayout importable for project layout persistence.
EOF
)"
```

---

### Task 4: Migrate personal DashboardPage to pages/

**Files:**
- Create: `apps/web/src/pages/DashboardPage/{DashboardPage.tsx,DashboardPage.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — import from `./pages/DashboardPage`
- Delete: `apps/web/src/components/DashboardPage.tsx`
- Test: `apps/web/test/dashboardExport.test.ts`

**Interfaces:**
- Consumes: `ModularDashboard` from `../../components/ModularDashboard`; widgets from `../../components/widgets/<Name>`; layout helpers from `../../lib/dashboard`
- Produces: `export function DashboardPage(props: DashboardPageProps): JSX.Element` where `DashboardPageProps = { currentUser: User }`
- `DashboardPage.module.css` may be minimal/empty placeholder only if the page adds no chrome; keep the file for unit shape consistency (can contain a trivial `.root` unused, or leave a comment-free empty file — prefer a tiny unused-safe file with no rules only if the test requires non-empty; if empty files fail the length check, add `:root { }` is wrong — instead keep a no-op local class on a fragment wrapper only if needed. Simplest: wrap ModularDashboard in `<div className={styles.root}>` with `.root { display: contents; }` so layout is unchanged)

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='App imports DashboardPage|DashboardPage unit'`
Expected: FAIL

- [ ] **Step 3: Implement page**

1. Move catalog/icons/render switch + ModularDashboard wiring into `pages/DashboardPage`
2. Update App import
3. Delete flat `components/DashboardPage.tsx`

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='DashboardPage|WidgetShell|home widgets|ModularDashboard|dashboard'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/DashboardPage apps/web/src/App.tsx apps/web/test/dashboardExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate DashboardPage to pages with CSS Modules

Move the personal dashboard shell under pages/ and rewire App imports.
EOF
)"
```

---

### Task 5: Migrate ProjectDashboard to ProjectDashboardPage + parts

**Files:**
- Create: `apps/web/src/pages/ProjectDashboardPage/{ProjectDashboardPage.tsx,ProjectDashboardPage.module.css,types.ts,index.ts}`
- Create: `apps/web/src/pages/ProjectDashboardPage/parts/ProjectBars/{ProjectBars.tsx,ProjectBars.module.css,types.ts,index.ts}`
- Create: `apps/web/src/pages/ProjectDashboardPage/parts/ProjectModuleContent/{ProjectModuleContent.tsx,ProjectModuleContent.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — `ProjectDashboardPage` from `./pages/ProjectDashboardPage`; JSX `<ProjectDashboardPage project={currentProject} />`
- Modify: `apps/web/src/styles.css` — move project-dashboard chrome/chart/monitor/attention + modular composition + related mobile overrides into page/part modules
- Delete: `apps/web/src/components/ProjectDashboard.tsx`
- Test: `apps/web/test/dashboardExport.test.ts`

**Interfaces:**
- Consumes: `ModularDashboard` from `../../components/ModularDashboard`; `WidgetError` / `WidgetEmpty` / `WidgetLoading` from `../../components/WidgetShell`; project helpers from `../../lib/projectDashboard`, `api`, `widgetQuery`, `statusMeta`
- Produces: `export function ProjectDashboardPage(props: ProjectDashboardPageProps): JSX.Element` where `ProjectDashboardPageProps = { project: Project }`
- Keep remount wrapper: inner data component keyed by `project.id`
- Page root keeps global class `project-dashboard-modular` (dual-class) if composition selectors depend on it; composition rules live in `ProjectDashboardPage.module.css` using `:global(.project-dashboard-modular) :global(.dashboard-page)` (or equivalent dual-class targets)
- Delete dead unused legacy selectors (`.project-dashboard-grid`, `.project-dashboard-card`, `.project-dashboard-status-list`, `.project-dashboard-empty`) if nothing references them after the move

- [ ] **Step 1: Extend structure test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='App imports ProjectDashboardPage|ProjectDashboardPage unit'`
Expected: FAIL

- [ ] **Step 3: Implement page + parts**

1. Extract `ProjectBars` part (chart CSS)
2. Extract `ProjectModuleContent` part including `DeliveryWidget` (monitor/attention CSS)
3. Move shell (heading, metrics, ModularDashboard wiring, remount key) into `ProjectDashboardPage`
4. Move composition + mobile project-dashboard media rules into the page module
5. Rewire App; delete flat `ProjectDashboard.tsx`
6. Remove migrated project selectors from `styles.css`

- [ ] **Step 4: Run tests**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='ProjectDashboard|DashboardPage|ModularDashboard|home widgets|projectDashboard|dashboard'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProjectDashboardPage apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/dashboardExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): migrate ProjectDashboard to pages with CSS Modules

Move project dashboard chrome and module parts under pages/ProjectDashboardPage.
EOF
)"
```

---

### Task 6: Purge leftover selectors; version bump

**Files:**
- Modify: `apps/web/src/styles.css` — remove any remaining migrated dashboard/widget selectors and dead mobile fragments (keep non-dashboard mobile rules)
- Modify: `package.json`, `package-lock.json` — bump `0.1.25` → `0.1.26`
- Modify: `apps/web/test/dashboardExport.test.ts` — purge assertion

**Interfaces:** none

- [ ] **Step 1: Add purge assertion**

```ts
test("legacy dashboard/widget selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles.css"), "utf8");
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
```

Note: global hook class *names* may still appear in TSX as string literals (`widget-drag-handle`, `dashboard-page`); they must not remain as rule selectors in `styles.css`.

- [ ] **Step 2: Run test to verify fail until purge complete**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='legacy dashboard/widget selectors'`
Expected: FAIL if leftovers remain; otherwise already PASS — still confirm `.button`, `.modal-kicker`, login/phases/automation styles intact

- [ ] **Step 3: Purge + bump**

1. Finish removing migrated selectors/media-query fragments from `styles.css`
2. Confirm shared globals remain (`.button`, `.modal-kicker`, status/priority tokens)
3. Bump root version to `0.1.26` in `package.json` and both root version fields in `package-lock.json`

- [ ] **Step 4: Full verification**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual checklist:
- [ ] Personal dashboard: add widget, remove widget, reset layout, drag/resize
- [ ] Admin sees `agent_ops` in default layout / picker
- [ ] Project dashboard: refresh, module charts, switch project (remount)
- [ ] Narrow viewport: mobile widget list + FAB placement

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/test/dashboardExport.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
refactor(web): finish Dashboard CSS Modules migration

Purge leftover dashboard/widget selectors from global styles and bump the release version.
EOF
)"
```

---

## Self-review notes

- Spec coverage: DashboardPage, ProjectDashboardPage + parts, ModularDashboard, WidgetShell, widgets/*, ModuleLayout path, drag-handle hook, CSS purge, App wiring, verification, version bump — mapped to Tasks 1–6
- Placeholder scan: none
- Type consistency: `DashboardPageProps.currentUser`, `ProjectDashboardPageProps.project`, `ModuleLayout<T>` exported from ModularDashboard folder; App rename to `ProjectDashboardPage`
- Review Focus pinned: layout keys/defaults (Task 4 + existing dashboard tests), drag-handle + FAB (Tasks 1/3), mobile breakpoint (Task 3 module media), project remount (Task 5), modular composition (Task 5 page CSS)
- Out of scope preserved: Phases, Automations, AgentOps page, filter toolbar, modals, final `styles.css` retirement
