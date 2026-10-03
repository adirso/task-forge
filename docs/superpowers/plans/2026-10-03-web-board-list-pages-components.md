# Board & List pages migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Board and List into `pages/` with CSS Modules, folderize `TaskCard`, and pull board chrome out of `App.tsx`, without changing product behavior.

**Architecture:** Follow Approach A and the approved slice design. `BoardPage` owns phase banner/empty states plus column board (`parts/PhaseBanner`, `parts/BoardColumns`). `ListPage` owns the phase-grouped table. `TaskCard` becomes a top-level component unit. App keeps filters, URL phase sync, mutations, and modal orchestration; pages receive props/callbacks.

**Tech Stack:** React 19, Vite 6 (`*.module.css`), TypeScript, Node test runner (`tsx --test`), `@taskforge/contracts`

**Spec:** `docs/superpowers/specs/2026-10-03-web-board-list-pages-components-design.md`

## Global Constraints

- No intentional product behavior changes (DnD, phase select, empty/no-active states, merge CTA rules, list collapse persistence, open/create flows)
- CSS Modules only for migrated units; no new Board/List/TaskCard rules in root `styles.css`
- Public exports: `BoardPage`, `ListPage`, `TaskCard` (rename from `BoardView` / `ListView` at the page boundary)
- `parts/` are private to their page; do not import them from App or sibling pages
- Shared helpers stay in `src/lib/` (no JSX/CSS there)
- Keep global shared primitives still used elsewhere: `.button*`, `.status-dot*`, `.status-pill*`, `.priority*`, `.muted`, `.task-key`, `.pr-open` / `.pr-draft` / `.pr-merged` / `.pr-closed`, avatar classes
- Do not migrate Phases, Automations, Dashboard, project filter toolbar, or modals in this PR
- PRs targeting `main` must bump root `package.json` + `package-lock.json` version (`0.1.24` → `0.1.25`)
- Verify every task with the commands listed in that task

## Review Focus

- Board phase selector still updates the visible task set and URL sync remains owned by App
- Empty-phase vs no-active-phase vs populated columns still render under the same conditions as today
- Merge CTA visibility (phase merge target + active phase + owner/admin) and disabled label when incomplete tasks remain
- Drag-and-drop move still calls App `onMove` with the dropped task id and column status
- List phase collapse state still persists per project id in `localStorage` after remount
- TaskCard tag/dependency spacing looks correct after removing TaskTags/TaskDependencies `:global(.task-card)` shims

## File map (end state for this PR)

```
apps/web/src/
  App.tsx
  styles.css
  pages/
    BoardPage/
      BoardPage.tsx
      BoardPage.module.css
      types.ts
      index.ts
      parts/
        PhaseBanner/{PhaseBanner.tsx,PhaseBanner.module.css,types.ts,index.ts}
        BoardColumns/{BoardColumns.tsx,BoardColumns.module.css,types.ts,index.ts}
    ListPage/
      ListPage.tsx
      ListPage.module.css
      types.ts
      index.ts
  components/
    TaskCard/{TaskCard.tsx,TaskCard.module.css,types.ts,index.ts}
    TaskTags/          # shim CSS removed
    TaskDependencies/  # shim CSS removed
```

Delete flat: `components/BoardView.tsx`, `components/ListView.tsx`, `components/TaskCard.tsx`

---

### Task 1: Folderize TaskCard with CSS Modules; remove card shims

**Files:**
- Create: `apps/web/src/components/TaskCard/{TaskCard.tsx,TaskCard.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/components/BoardView.tsx` import → `./TaskCard`
- Modify: `apps/web/src/components/TaskTags/TaskTags.module.css` — remove `:global(.task-card) > .list` block
- Modify: `apps/web/src/components/TaskDependencies/TaskDependencies.module.css` — remove `:global(.task-card) > .list` block
- Modify: `apps/web/src/styles.css` — move TaskCard-owned rules into the module (`.task-card*`, `.card-top`, `.card-meta*`, `.card-assignee`, `.task-blocked-reason`, `.subtask-label`, `.pr-indicator`); leave `.task-key`, `.priority*`, `.pr-open`/`.pr-draft`/etc. global
- Delete: `apps/web/src/components/TaskCard.tsx`
- Test: `apps/web/test/boardListExport.test.ts` (create)

**Interfaces:**
- Consumes: existing `TaskCard` props `{ task: Task; project: Project; onOpen: () => void }`
- Produces: `export function TaskCard(props: TaskCardProps): JSX.Element` from `components/TaskCard`
- TaskCard module must include vertical spacing for direct child tag/dependency lists formerly provided by `:global(.task-card) > .list` (`display: flex; margin: -4px 0 10px` on those children — target via a wrapper class on the pills host or `:global` child if needed; prefer wrapping pills in `<div className={styles.pills}>` in TaskCard)

- [ ] **Step 1: Add structure test**

Create `apps/web/test/boardListExport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("TaskCard is a folder unit", () => {
  const index = readFileSync(resolve("src/components/TaskCard/index.ts"), "utf8");
  assert.match(index, /export \{ TaskCard \}/);
  for (const file of ["TaskCard.tsx", "TaskCard.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve("src/components/TaskCard", file), "utf8").length > 0, true, file);
  }
});

test("TaskTags and TaskDependencies no longer shim task-card layout", () => {
  for (const name of ["TaskTags", "TaskDependencies"]) {
    const css = readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8");
    assert.equal(css.includes(":global(.task-card)"), false, name);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='TaskCard is a folder|no longer shim'`
Expected: FAIL (folder missing / shim still present)

- [ ] **Step 3: Implement TaskCard unit**

1. Create `types.ts` with `TaskCardProps`
2. Move implementation; replace class strings with `styles.*`
3. Wrap `<TaskTagPills />` and `<TaskDependencyPills />` in elements that carry card spacing classes so layout matches previous `.task-card > .list` margins
4. Keep using global `priority`, `task-key`, `pr-open`/`pr-draft` class names where those tokens remain global
5. Update `BoardView` import to `./TaskCard`
6. Delete flat `TaskCard.tsx`
7. Remove shim blocks from TaskTags/TaskDependencies modules
8. Remove migrated TaskCard selectors from `styles.css`

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TaskCard apps/web/src/components/BoardView.tsx apps/web/src/components/TaskTags apps/web/src/components/TaskDependencies apps/web/src/styles.css apps/web/test/boardListExport.test.ts
git rm apps/web/src/components/TaskCard.tsx
git commit -m "$(cat <<'EOF'
refactor(web): folderize TaskCard with CSS Modules

Move board card UI into a component unit and drop temporary task-card CSS shims.
EOF
)"
```

---

### Task 2: Migrate ListView to pages/ListPage

**Files:**
- Create: `apps/web/src/pages/ListPage/{ListPage.tsx,ListPage.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — import `ListPage` from `./pages/ListPage`; replace `<ListView …>` with `<ListPage …>`
- Modify: `apps/web/src/styles.css` — move list-only selectors into the module (`.phase-list-stack`, `.phase-table-*`, `.list-shell`, `.task-table*`, `.list-task-title*`, `.list-dependency-state*`, `.list-pr*`, `.assignee-cell`, `.date-cell`, list mobile overrides that only target these)
- Modify: `apps/web/test/boardListExport.test.ts`
- Delete: `apps/web/src/components/ListView.tsx`

**Interfaces:**
- Consumes: current ListView props
- Produces:

```ts
export type ListPageProps = {
  tasks: Task[];
  phases: Phase[];
  project: Project;
  onOpen: (task: Task) => void;
};
export function ListPage(props: ListPageProps): JSX.Element;
```

- Collapse storage key remains `taskforge_list_collapsed_phases:${projectId}`
- Do not rename PhaseManager’s distinct `.phase-list` rules (different surface)

- [ ] **Step 1: Extend structure test**

Append to `boardListExport.test.ts`:

```ts
test("App imports ListPage from pages/ListPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/ListPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/ListView["']/);
});

test("ListPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/ListPage");
  for (const file of ["index.ts", "ListPage.tsx", "ListPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='ListPage'`
Expected: FAIL

- [ ] **Step 3: Implement ListPage**

1. Move `ListView` body into `ListPage.tsx` with `ListPageProps`
2. Move list CSS into `ListPage.module.css`; keep shared globals (`.status-pill`, `.priority*`, `.muted`, `.task-key`, `.pr-*` tone colors)
3. Update relative imports (`../../lib/ui`, `../../components/Avatar`, TaskTags/Dependencies/TypePill)
4. Export from `index.ts`
5. Rewire App; delete `ListView.tsx`
6. Remove migrated list selectors from `styles.css` (leave PhaseManager `.phase-list` alone)

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ListPage apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/boardListExport.test.ts
git rm apps/web/src/components/ListView.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate ListView to ListPage with CSS Modules

Move the phase-grouped list screen into pages/ and co-locate its styles.
EOF
)"
```

---

### Task 3: Migrate BoardView + App chrome to pages/BoardPage

**Files:**
- Create: `apps/web/src/pages/BoardPage/{BoardPage.tsx,BoardPage.module.css,types.ts,index.ts}`
- Create: `apps/web/src/pages/BoardPage/parts/PhaseBanner/{PhaseBanner.tsx,PhaseBanner.module.css,types.ts,index.ts}`
- Create: `apps/web/src/pages/BoardPage/parts/BoardColumns/{BoardColumns.tsx,BoardColumns.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/App.tsx` — replace the entire `view === "board" ? …` chrome+BoardView branch with `<BoardPage … />`
- Modify: `apps/web/src/styles.css` — move board chrome + column CSS into modules
- Modify: `apps/web/test/boardListExport.test.ts`
- Delete: `apps/web/src/components/BoardView.tsx`

**Interfaces:**

```ts
import type { Phase, Project, Task, TaskStatus, User } from "@taskforge/contracts";

export type BoardPageProps = {
  project: Project;
  phases: Phase[];
  selectedPhase: Phase | null;
  tasks: Task[];
  hasTasksInSelectedPhase: boolean;
  currentUser: User;
  onPhaseChange: (phaseId: string) => void;
  onOpen: (task: Task) => void;
  onCreate: (status: TaskStatus) => void;
  onMove: (id: string, status: TaskStatus) => void;
  onManagePhases: () => void;
  onMergePhase: () => void;
};
```

`BoardPage` behavior (must match App today):
1. If `!selectedPhase` → no-active-phase empty state + Manage phases button calling `onManagePhases`
2. Else render `PhaseBanner` with phase badge/copy/selector/count; show merge button only when `project.mergeTarget === "phase" && selectedPhase.isActive && (currentUser.role === "ADMIN" || currentUser.id === project.ownerId)`; button label/disabled via `canMergePhaseToMain(project.mergeTarget, selectedPhase.nonDoneTaskCount ?? 0)` imported from `../../lib/phaseMerge`
3. If `hasTasksInSelectedPhase` → `BoardColumns` with `tasks` / create / move / open; else empty-board-phase CTA that calls `onCreate(project.defaultStatus)`

`BoardColumns` is the current `BoardView` implementation (column visibility / hidden empty statuses / DnD / TaskCard).

`PhaseBanner` owns banner + selector + merge/manage actions UI only.

App wiring example (keep App computations of `selectedBoardPhase`, `boardTasks`, `selectedPhaseHasTasks`):

```tsx
view === "board" ? (
  <BoardPage
    project={currentProject}
    phases={phases}
    selectedPhase={selectedBoardPhase}
    tasks={boardTasks}
    hasTasksInSelectedPhase={selectedPhaseHasTasks}
    currentUser={user}
    onPhaseChange={setBoardPhaseId}
    onOpen={setSelectedTask}
    onCreate={setNewTaskStatus}
    onMove={moveTask}
    onManagePhases={() => setView("phases")}
    onMergePhase={() => { void mergeActivePhase(); }}
  />
) : (
  <ListPage tasks={visibleTasks} phases={phases} project={currentProject} onOpen={setSelectedTask} />
)
```

Remove unused App imports (`BoardView`, `Flag`/`Plus`/`ChevronDown` only if no longer needed elsewhere in App — check before deleting).

- [ ] **Step 1: Extend structure test**

```ts
test("App imports BoardPage from pages/BoardPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/BoardPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/BoardView["']/);
  assert.doesNotMatch(app, /active-phase-banner/);
});

test("BoardPage unit exposes shell and parts tree", () => {
  const root = resolve("src/pages/BoardPage");
  for (const file of ["index.ts", "BoardPage.tsx", "BoardPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
  for (const part of ["PhaseBanner", "BoardColumns"]) {
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.tsx`), "utf8").length > 0, true, part);
    assert.equal(readFileSync(resolve(root, `parts/${part}/${part}.module.css`), "utf8").length > 0, true, `${part}.css`);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='BoardPage'`
Expected: FAIL

- [ ] **Step 3: Implement BoardPage + parts + App rewire**

1. Create types + parts + BoardPage shell with CSS Modules
2. Move `.active-phase-banner*`, `.board-phase-selector*`, `.no-active-phase*`, `.empty-board-phase*`, `.board`, `.board-column*`, `.column-body`, `.add-task-quiet*` (and board-only mobile overrides) into the appropriate modules
3. Rewire App; delete `BoardView.tsx`
4. Ensure App no longer contains `active-phase-banner` markup

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BoardPage apps/web/src/App.tsx apps/web/src/styles.css apps/web/test/boardListExport.test.ts
git rm apps/web/src/components/BoardView.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate board chrome and columns to BoardPage

Move App-owned board banner/empty states and BoardView into pages/BoardPage with CSS Modules.
EOF
)"
```

---

### Task 4: Purge leftover selectors; version bump

**Files:**
- Modify: `apps/web/src/styles.css` — remove any remaining migrated Board/List/TaskCard selectors and dead mobile fragments
- Modify: `package.json`, `package-lock.json` — bump `0.1.24` → `0.1.25`
- Modify: `apps/web/test/boardListExport.test.ts` — purge assertion

**Interfaces:** none

- [ ] **Step 1: Add purge assertion**

```ts
test("legacy Board/List selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles.css"), "utf8");
  for (const selector of [".active-phase-banner", ".board-column", ".phase-list-stack", ".task-card", ".add-task-quiet", ".empty-board-phase"]) {
    assert.equal(css.includes(selector), false, selector);
  }
});
```

- [ ] **Step 2: Run test to verify fail until purge complete**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='legacy Board/List selectors'`
Expected: FAIL if leftovers remain; otherwise already PASS — still confirm ProjectModal/login/PhaseManager styles intact

- [ ] **Step 3: Purge + bump**

1. Finish removing migrated selectors/media-query fragments
2. Confirm shared globals remain (`.status-dot`, `.status-pill`, `.priority`, `.button`, PhaseManager `.phase-list`)
3. Bump root version to `0.1.25` in `package.json` and both root version fields in `package-lock.json`

- [ ] **Step 4: Full verification**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual checklist:
- [ ] Board phase change
- [ ] Empty phase / no active phase
- [ ] DnD move + create from column
- [ ] Merge CTA when eligible
- [ ] List open task + collapse persistence
- [ ] TaskCard tags/deps/type pills spacing

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/test/boardListExport.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
refactor(web): finish Board/List CSS Modules migration

Purge leftover board/list selectors from global styles and bump the release version.
EOF
)"
```

---

## Self-review notes

- Spec coverage: BoardPage chrome + columns, ListPage, TaskCard, shim removal, App props contract, CSS split, verification, version bump — each mapped to Tasks 1–4
- Placeholder scan: none
- Type consistency: `BoardPageProps` / `ListPageProps` / `TaskCardProps` match across tasks; App keeps `boardTasks` / `selectedPhaseHasTasks` computations
- Review Focus items pinned: URL/phase ownership stays in App (Task 3 wiring); empty/no-active branches in BoardPage (Task 3); merge rules use `canMergePhaseToMain` inside BoardPage (Task 3); DnD via BoardColumns `onMove` (Task 3); list collapse key unchanged (Task 2); TaskCard pill spacing (Task 1)
- Out of scope preserved: Dashboard, Phases, Automations, filter toolbar, modals
