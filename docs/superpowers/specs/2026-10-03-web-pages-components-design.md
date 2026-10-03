# Web pages & components structure — Design Spec

**Date:** 2026-10-03  
**Status:** Approved  
**Scope:** `apps/web` structural refactor only — no intentional product behavior changes

## Overview

Restructure `apps/web` so UI is organized for reuse and ownership:

- **Pages** compose screens driven by `App` view/routing state
- **Components** are reusable UI units
- Each UI unit owns its **TSX**, **CSS Modules**, and **types**
- Large units split into a private **`parts/`** folder of minor components

Migration is **incremental**. The first slice is Settings. Later PRs migrate the remaining surfaces and retire the monolithic global stylesheet.

## Goals

- Clear separation between page-level screens and reusable components
- Co-located styling via CSS Modules to avoid global class collisions
- Predictable folder shape for new UI work
- Safer reviews through small, verifiable migration PRs

## Non-goals

- Changing TaskForge product behavior, API contracts, or routing model
- Introducing a new router library
- Moving non-UI helpers out of `lib/` into feature folders
- Converting the entire app in a single PR

## 1. Target tree

```
apps/web/src/
  main.tsx
  App.tsx                         # shell: auth, workspace load, view state
  styles/
    global.css                    # resets, CSS variables, base element styles only
  pages/
    <PageName>/
      PageName.tsx
      PageName.module.css
      types.ts
      index.ts
      parts/                      # optional
        <PartName>/
          PartName.tsx
          PartName.module.css
          types.ts
          index.ts
  components/
    <ComponentName>/
      ComponentName.tsx
      ComponentName.module.css
      types.ts
      index.ts
      parts/                      # optional
    widgets/
      <WidgetName>/
        ...same unit shape...
  lib/                            # pure TS helpers/API only (no JSX, no CSS)
```

During migration, the existing root `styles.css` remains as a shrinking compatibility layer until its rules are extracted.

## 2. Unit conventions

### 2.1 Required files

| File | Purpose |
|---|---|
| `Name.tsx` | React implementation |
| `Name.module.css` | Scoped styles for this unit |
| `types.ts` | Props and local types; may re-export or compose `@taskforge/contracts` types |
| `index.ts` | Public barrel export for the unit |

### 2.2 `parts/`

- Use only when a parent has meaningful private sub-UI
- Parts are **private** to the parent; other features must not import them
- If a part is needed by 2+ parents, promote it to `components/<Name>/`

### 2.3 Imports

- Prefer barrel imports: `import { Sidebar } from "../components/Sidebar"`
- Relative imports inside a unit/parts tree are fine
- Do not deep-import another unit’s internals (`.../Sidebar/parts/...`)

### 2.4 CSS Modules

- Class names in TSX come from `styles` imported from `./Name.module.css`
- Prefer local semantic class names (`root`, `header`, `tokenList`) over legacy global BEM leftovers
- Global tokens/variables live in `styles/global.css`
- No new rules added to the legacy root `styles.css` except temporary migration shims when unavoidable

### 2.5 `lib/`

- Remains the home for API clients and pure helpers (`api`, `settingsNav`, `ui`, dashboard math, etc.)
- No JSX and no CSS Modules in `lib/`

## 3. Pages vs components mapping

### 3.1 Pages

| Current | Target page |
|---|---|
| `Login` | `pages/Login` |
| `DashboardPage` | `pages/DashboardPage` |
| `SettingsPage` | `pages/SettingsPage` |
| `BoardView` | `pages/BoardPage` (rename) |
| `ListView` | `pages/ListPage` (rename) |
| `PhaseManager` (`PhasesPage`) | `pages/PhasesPage` |
| `AutomationManager` | `pages/AutomationsPage` (rename) |
| `ProjectDashboard` | `pages/ProjectDashboardPage` (rename) |
| `AgentOpsPage` | `pages/AgentOpsPage` |

`App.tsx` stays the shell and imports pages/components; it is not itself a page folder in the first slice.

### 3.2 Components

Examples of reusable/chrome/modal units that remain under `components/`:

- Shell: `Sidebar`, `Avatar`, `NotificationPanel`, `SearchPalette`, `MultiFilterDropdown`, `ProjectHeaderActions`
- Task/project UI: `TaskCard`, `TaskModal`, `TaskDependencies`, `TaskTags`, `TaskTypePill`, `ProjectModal`, `ProjectMembersModal`, `ProjectDeleteModal`, `PhaseDeleteModal`, `PhaseMergeModal`, `LogoutConfirmModal`, `SendToAI`
- Settings building blocks reused outside a single page: `WebhookManager`, `WebhookDeliveriesPanel`, `RevealTokenConfirmModal`, `AgentCapabilityEditor`
- Dashboard building blocks: `ModularDashboard`, `WidgetShell`, `widgets/*`

Settings-only sub-UI may live under `pages/SettingsPage/parts/` instead of top-level `components/` when it is not reused.

## 4. Migration strategy

### 4.1 Incremental slices

1. **Settings (first PR)** — establish the pattern end-to-end
2. Task modal + related task parts
3. Board/List pages
4. Dashboard + widgets
5. Remaining chrome/modals
6. Final cleanup: remove empty legacy `styles.css` / leftover global selectors

Each slice must keep behavior unchanged and pass web typecheck, tests, and build.

### 4.2 First slice details (Settings)

1. Branch from `main`
2. Create `pages/SettingsPage/` with CSS Modules + `types.ts` + `index.ts`
3. Extract natural Settings `parts/` (for example agents section, token access UI, new-agent form) when they clarify ownership
4. Keep already-shared Settings children as top-level components (`WebhookManager`, `WebhookDeliveriesPanel`, `RevealTokenConfirmModal`, `AgentCapabilityEditor`) unless they are Settings-exclusive after inspection
5. Move Settings-related rules out of root `styles.css` into the new modules
6. Update `App.tsx` import path
7. Update tests that encode Settings panel/tab structure if paths or exported constants move
8. Do not migrate unrelated screens in the same PR

### 4.3 Compatibility rules during migration

- Unmigrated UI continues using legacy global CSS
- Migrated UI must not depend on new global class names
- Class-name renames inside a migrated unit are allowed if visuals stay equivalent
- Public component export names should stay stable where practical (`SettingsPage`, etc.) even if folder paths change

## 5. Testing & verification

For every migration PR:

- `npm run typecheck -w @taskforge/web`
- `npm run test -w @taskforge/web`
- `npm run build -w @taskforge/web`
- Manual smoke of the migrated surface (Settings first: tabs, URL persistence, new-agent form, token reveal modal)

Root package version must be bumped for PRs targeting `main`/`master`, per repo policy.

## 6. Success criteria

- New Settings UI lives under `pages/SettingsPage/` with co-located CSS Modules and types
- Settings no longer relies on legacy global selectors for its migrated UI
- Folder conventions are documented and usable by later slices
- No intentional product regressions

## 7. Open follow-ups (later slices)

- Exact `parts/` breakdown for `TaskModal` and board column/card trees
- Whether `ModularDashboard` becomes a page-owned part of `DashboardPage` or stays a shared component
- Final deletion checklist for legacy `styles.css`
