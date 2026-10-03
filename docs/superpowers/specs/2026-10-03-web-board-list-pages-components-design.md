# Board & List pages migration — Slice Design

**Date:** 2026-10-03  
**Status:** Approved  
**Parent spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`  
**Slice:** 3 — Board/List pages (Approach A)

## Overview

Migrate the project Board and List surfaces into `pages/` with CSS Modules, folderize the shared `TaskCard`, and pull board chrome currently inlined in `App.tsx` into `BoardPage`. No intentional product behavior changes.

## Goals

- Establish `pages/BoardPage` and `pages/ListPage` following the same unit shape as Settings
- Move board phase banner, phase selector, empty / no-active states, and merge CTA out of `App.tsx` into `BoardPage`
- Folderize `TaskCard` with CSS Modules and remove temporary TaskTags/TaskDependencies `:global(.task-card)` shims
- Remove Board/List/TaskCard-owned selectors from root `styles.css` while preserving shared primitives

## Non-goals

- Product behavior changes (DnD, filters, URL phase sync, collapse persistence, merge authorization)
- Moving filter/search toolbar, project tabs, or Phases/Automations/Dashboard pages
- Relocating App-owned state (`boardPhaseId`, task lists, `moveTask`, merge API calls) into pages
- Migrating `status-dot`, `status-pill`, or `priority*` globals still shared by ProjectModal, Search, TaskModal, etc.
- Dashboard + widgets (slice 4) or remaining modals/chrome (slice 5)

## 1. Target tree

```
apps/web/src/
  App.tsx                                      # import pages/BoardPage, pages/ListPage
  styles.css                                   # board/list/task-card selectors removed or reduced
  pages/
    BoardPage/
      BoardPage.tsx
      BoardPage.module.css
      types.ts
      index.ts
      parts/
        PhaseBanner/
        BoardColumns/
    ListPage/
      ListPage.tsx
      ListPage.module.css
      types.ts
      index.ts
  components/
    TaskCard/
      TaskCard.tsx
      TaskCard.module.css
      types.ts
      index.ts
```

Optional: `ListPage/parts/PhaseGroup/` only if collapse/table ownership is clearer as a part; default is a single ListPage unit.

## 2. Architecture

### 2.1 Approach

Page shells + private parts + shared `TaskCard`:

- `BoardPage` owns presentation of board chrome and columns
- `ListPage` owns the phase-grouped task table
- `TaskCard` remains a top-level reusable component (Board only today)
- `App` keeps data loading, filters, URL sync, mutations, and modal orchestration; pages receive props/callbacks

### 2.2 BoardPage contract

`BoardPage` receives (names may be refined in the plan, semantics fixed):

| Prop / callback | Role |
| --- | --- |
| `project`, `phases`, `selectedPhase` | Phase context for banner + board |
| `tasks` | Already filtered to the selected board phase (`boardTasks`) |
| `hasTasksInSelectedPhase` | Distinguishes empty-phase vs columns with filtered-empty columns |
| `currentUser` | Merge CTA authorization display (owner/admin) |
| `canMerge` / merge visibility inputs | Same rules as today’s merge button |
| `onPhaseChange` | Updates App `boardPhaseId` |
| `onOpen`, `onCreate`, `onMove` | Open task modal / create / DnD status change |
| `onManagePhases` | Navigate to phases view |
| `onMergePhase` | Trigger App `mergeActivePhase` |

Empty-phase and no-active-phase UIs render inside `BoardPage` (private parts or inline).

### 2.3 ListPage contract

Stable public export `ListPage` with the current `ListView` props:

- `tasks`, `phases`, `project`, `onOpen`
- Local collapse state + `localStorage` key behavior unchanged

### 2.4 TaskCard

- Move into `components/TaskCard/`
- Own card layout CSS, including vertical spacing previously applied via `.task-card > .task-tag-list` / dependency list shims
- Remove `:global(.task-card) > .list` rules from `TaskTags` / `TaskDependencies` modules after TaskCard owns that spacing

### 2.5 CSS ownership

**Move into modules (Board/List/TaskCard):**  
`.active-phase-banner*`, `.board-phase-selector*`, `.no-active-phase*`, `.empty-board-phase*`, `.board*`, `.board-column*`, `.column-body`, `.task-card*`, `.card-*`, `.add-task-quiet*`, `.phase-list-stack`, `.phase-table-*`, `.list-shell`, `.task-table*`, `.list-task-title*`, `.list-dependency-state*`, `.list-pr*`, `.assignee-cell`, `.date-cell`, board/list mobile overrides that only target these, plus TaskCard-only helpers (`.task-blocked-reason`, `.subtask-label`, `.pr-indicator` when unused elsewhere after inspection).

**Keep global for now:**  
`.button*`, `.status-dot*`, `.status-pill*`, `.priority*`, `.muted`, `.task-key` if still shared, avatar classes, project-tabs / content-area chrome, PhaseManager’s distinct `.phase-list` (not list-page stack).

Inspect each candidate before deletion; do not strip selectors still used by unmigrated screens.

## 3. App wiring

Replace the inline board ternary JSX with:

```tsx
view === "board"
  ? <BoardPage ... />
  : <ListPage tasks={visibleTasks} phases={phases} project={currentProject} onOpen={setSelectedTask} />
```

Delete flat `components/BoardView.tsx`, `components/ListView.tsx`, and `components/TaskCard.tsx` after rewiring.

Public export names: `BoardPage`, `ListPage`, `TaskCard` (rename from `BoardView` / `ListView` at the page boundary; App imports update accordingly).

## 4. Testing & verification

- Structure/export tests for page units, TaskCard folder, and App import paths
- Assertion that legacy board/list/task-card selectors are absent from `styles.css` after purge
- `npm run test -w @taskforge/web`
- `npm run typecheck -w @taskforge/web`
- `npm run build -w @taskforge/web`
- Manual smoke: board/list switch, phase change, DnD, create-from-column, open from list, phase collapse, merge CTA when eligible
- Root version bump `0.1.24` → `0.1.25` for the PR targeting `main`

## 5. Success criteria

- Board chrome no longer lives inline in `App.tsx`
- Board and List screens live under `pages/` with CSS Modules and typed props
- `TaskCard` is a folder unit; TaskTags/TaskDependencies no longer shim `.task-card` layout
- Board/List/TaskCard-owned global CSS removed; shared status/priority primitives preserved
- No intentional product regressions

## 6. Follow-ups (not this PR)

- Dashboard + widgets (slice 4)
- Remaining modals / shell chrome (slice 5)
- Final `styles.css` retirement (slice 6)
- Whether ListPage should later extract `PhaseGroup` as a part
