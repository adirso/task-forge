# Dashboard & widgets migration — Slice Design

**Date:** 2026-10-03  
**Status:** Approved  
**Parent spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`  
**Slice:** 4 — Dashboard + widgets (Approach A)

## Overview

Migrate the personal and project dashboard surfaces into `pages/` with CSS Modules, and folderize shared dashboard building blocks (`ModularDashboard`, `WidgetShell`, and each widget) as top-level component units. No intentional product behavior changes.

## Goals

- Establish `pages/DashboardPage` and `pages/ProjectDashboardPage` following the same unit shape as Settings / Board / List
- Keep `ModularDashboard`, `WidgetShell`, and `widgets/*` as shared top-level `components/` folders (used by both dashboards)
- Extract project-only presentation (`ProjectBars`, module bodies / delivery widget, heading + metrics chrome) into `ProjectDashboardPage/parts/`
- Remove dashboard/widget-owned selectors from root `styles.css` while preserving shared primitives still used by unmigrated screens
- Preserve grid DnD via a stable global drag-handle class for `react-grid-layout`

## Non-goals

- Product behavior changes (layout persistence, widget catalog, add/remove/reset, mobile list, project metrics queries)
- Moving Phases, Automations, AgentOps page, filter toolbar, sidebar, or App view switching
- Putting JSX or CSS Modules into `lib/` (`dashboard`, `projectDashboard`, `widgetQuery`, `dashboardNav` stay logic-only)
- Nesting `ModularDashboard` under a single page (rejected; both dashboards consume it)
- Remaining modals / shell chrome (slice 5) or final `styles.css` retirement (slice 6)

## 1. Target tree

```
apps/web/src/
  App.tsx                                      # import pages/DashboardPage, pages/ProjectDashboardPage
  styles.css                                   # dashboard/widget selectors removed or reduced
  pages/
    DashboardPage/
      DashboardPage.tsx
      DashboardPage.module.css                 # only if page-owned chrome appears; may be empty/minimal
      types.ts
      index.ts
    ProjectDashboardPage/
      ProjectDashboardPage.tsx
      ProjectDashboardPage.module.css
      types.ts
      index.ts
      parts/
        ProjectBars/
        ProjectModuleContent/                  # includes DeliveryWidget
  components/
    ModularDashboard/
      ModularDashboard.tsx
      ModularDashboard.module.css
      types.ts                                 # includes ModuleLayout
      index.ts
    WidgetShell/
      WidgetShell.tsx
      WidgetShell.module.css
      types.ts
      index.ts                                 # export WidgetShell, WidgetError
    widgets/
      ProjectStatusWidget/
      ProjectProgressWidget/
      ProjectTimeWidget/
      MyTasksWidget/
      StuckTasksWidget/
      ActivityWidget/
      AgentOpsWidget/
  lib/                                         # logic unchanged; type import path may update
```

Each component/page unit uses `tsx` + `*.module.css` + `types.ts` + `index.ts`. Widget folders follow the same shape.

## 2. Architecture

### 2.1 Approach

Two pages + shared dashboard toolkit:

- `DashboardPage` owns the personal catalog, icons, and `renderWidgetContent` switch; it composes `ModularDashboard` and home widgets
- `ProjectDashboardPage` owns project heading, summary metrics, data loading remount-by-`project.id`, and module rendering; it composes `ModularDashboard`
- `ModularDashboard` owns grid canvas, empty state, mobile list, FAB, widget picker, and layout mutation UI
- `WidgetShell` owns card chrome, refresh registration, close control, and `WidgetError`
- Individual widgets own their content markup and content-specific CSS
- `App` only rewires imports; it does not absorb dashboard presentation

### 2.2 DashboardPage contract

Stable public export `DashboardPage` with today’s prop:

| Prop | Role |
| --- | --- |
| `currentUser` | Role-aware default layout + `agent_ops` widget |

Behavior (catalog, `loadLayout` / `saveLayout` / `defaultLayout`, widget render switch) stays equivalent.

### 2.3 ProjectDashboardPage contract

Stable public export `ProjectDashboardPage` (rename from `ProjectDashboard`) with today’s prop:

| Prop | Role |
| --- | --- |
| `project` | Scope for layout keys, metrics query, heading copy |

Internal structure:

- Outer remount wrapper keyed by `project.id` (same late-response isolation as today)
- Parts for `ProjectBars` and `ProjectModuleContent` (including `DeliveryWidget`)
- Page module owns `.project-dashboard*` chrome and composition with the embedded modular grid

### 2.4 Shared components

**ModularDashboard**

- Move into `components/ModularDashboard/`
- Export `ModularDashboard` and `ModuleLayout<T>` from the unit (`types.ts` + `index.ts`)
- Update `lib/projectDashboard` to import `ModuleLayout` from the new path (type-only; no JSX in lib)
- Own grid/FAB/picker/empty/mobile CSS
- Keep vendor CSS imports: `react-grid-layout/css/styles.css`, `react-resizable/css/styles.css`

**WidgetShell**

- Move into `components/WidgetShell/`
- Export `WidgetShell` and `WidgetError`
- Own card shell, error/retry, and shared empty/loading/skeleton styles used across widgets when those classes are only dashboard-owned

**widgets/\***

- One folder per existing widget file
- Each owns its content CSS (e.g. `.widget-project-status`, `.widget-task-list`, `.widget-activity`, `.widget-agent-ops`, …)

### 2.5 CSS ownership

**Move into modules:**  
`.dashboard-page`, `.dashboard-canvas`, `.dashboard-grid*`, `.dashboard-hidden`, `.dashboard-empty*`, `.dashboard-fab*`, `.dashboard-mobile-*`, `.widget-card*`, `.widget-drag-handle*`, `.widget-header-*`, `.widget-refresh`, `.widget-close`, `.widget-body`, `.widget-loading`, `.widget-skeleton*`, `.widget-error`, `.widget-retry`, `.widget-empty`, `.widget-picker*`, `.widget-project-*`, `.widget-task-*`, `.widget-activity*`, `.widget-agent-ops*`, `.project-dashboard*`, `.project-chart*`, `.project-monitor*`, `.project-attention*`, related mobile overrides that only target these, and react-grid placeholder/handle tweaks that are dashboard-owned.

**Keep global for now:**  
`.button*`, `.modal-kicker`, status/priority/avatar primitives still shared by unmigrated screens, and non-dashboard rules in the mobile media block.

**Drag-handle hook:**  
`ModularDashboard` continues to configure `dragConfig.handle` with a stable global class (today: `.widget-drag-handle`). `WidgetShell` applies that global class alongside the CSS Module class so drag-and-drop keeps working after modularization.

**Project ↔ modular composition:**  
Today’s `.project-dashboard-modular .dashboard-page` (and related) overrides move into `ProjectDashboardPage.module.css` via `:global` composition against the same stable class hooks, or an equivalent wrapper class — visual parity required, no layout algorithm changes.

Inspect each candidate before deletion; do not strip selectors still used by unmigrated screens. Delete dead legacy project-dashboard card/grid selectors that nothing references after migration.

## 3. App wiring

```tsx
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectDashboardPage } from "./pages/ProjectDashboardPage";

// project view
{view === "dashboard" && <ProjectDashboardPage project={currentProject} />}

// home (no project)
<DashboardPage currentUser={user} />
```

Delete flat `components/DashboardPage.tsx`, `components/ProjectDashboard.tsx`, `components/ModularDashboard.tsx`, `components/WidgetShell.tsx`, and flat `components/widgets/*.tsx` after rewiring.

Public export names: `DashboardPage`, `ProjectDashboardPage`, `ModularDashboard`, `WidgetShell`, `WidgetError`, plus each widget’s existing export name.

## 4. Testing & verification

- Structure/export tests for both pages, `ModularDashboard`, `WidgetShell`, widget folders, and App import paths
- Assertion that migrated dashboard/widget selector strings are absent from `styles.css` after purge
- Existing `dashboard.test.ts`, `projectDashboard.test.ts`, `widgetQuery.test.ts`, and related lib tests remain green
- `npm run test -w @taskforge/web`
- `npm run typecheck -w @taskforge/web`
- `npm run build -w @taskforge/web`
- Manual smoke: personal dashboard add/remove/reset/drag-resize; project dashboard refresh + modules; mobile list layout
- Root version bump for the PR targeting `main` (from current `0.1.25` → next patch)

## 5. Success criteria

- Personal and project dashboards live under `pages/` with CSS Modules and typed props
- `ModularDashboard`, `WidgetShell`, and each widget are folder units with co-located styles
- Dashboard/widget-owned global CSS removed; shared button/kicker/status primitives preserved
- Grid drag handle and layout persistence behavior unchanged
- No intentional product regressions

## 6. Follow-ups (not this PR)

- Remaining modals / shell chrome (slice 5)
- Final `styles.css` retirement (slice 6)
- Whether ModularDashboard should later extract picker/FAB as private `parts/`
