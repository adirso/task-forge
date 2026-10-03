# Remaining chrome, modals & pages migration — Slice Design

**Date:** 2026-10-03  
**Status:** Approved  
**Parent spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`  
**Slice:** 5 — Remaining chrome / modals / pages (Approach A, one PR)

## Overview

Migrate the remaining web surfaces into `pages/` and folderized `components/` with CSS Modules: Login, Phases, Automations, AgentOps, shell chrome, and project/phase/logout modals. No intentional product behavior changes. Shared button/modal/status primitives stay global until slice 6.

## Goals

- Establish `pages/Login`, `pages/PhasesPage`, `pages/AutomationsPage`, `pages/AgentOpsPage` with the same unit shape as prior slices
- Folderize shell units: `Sidebar`, `Avatar`, `NotificationPanel`, `SearchPalette`, `MultiFilterDropdown`, `ProjectHeaderActions`
- Folderize modals: `ProjectModal`, `ProjectMembersModal`, `ProjectDeleteModal`, `PhaseDeleteModal`, `PhaseMergeModal`, `LogoutConfirmModal`
- Remove migrated selectors from root `styles.css` while preserving shared primitives and App-owned chrome (tabs/toolbar/content-area) when still cross-cutting
- Rewire App (and Settings for `AgentOpsPage`) imports only

## Non-goals

- Product behavior changes
- Extracting a new shared `ModalShell` / form-primitives system (deferred; keep `.modal-backdrop` / `.button*` global)
- Pulling App-owned project tabs, filter toolbar, or content-area layout into pages in this slice unless a selector is proven exclusive to a migrated unit
- Final deletion / empty retirement of `styles.css` (slice 6)
- Relocating business logic into `lib/` or changing API contracts

## 1. Target tree

```
apps/web/src/
  App.tsx
  styles.css                                   # migrated selectors removed; shared leftovers remain
  pages/
    Login/
    PhasesPage/                                # from components/PhaseManager.tsx (export already PhasesPage)
    AutomationsPage/                           # rename from AutomationManager
    AgentOpsPage/                              # also imported by SettingsPage
    SettingsPage/                              # already migrated; update AgentOps import only
    ...
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
    ...                                        # already-migrated TaskModal, TaskCard, widgets, etc.
```

Each unit: `tsx` + `*.module.css` + `types.ts` + `index.ts`. Page-private sub-UI may use `parts/` when ownership is clearer (e.g. automation builder vs list); default is a single unit per surface.

## 2. Architecture

### 2.1 Approach

One PR covering all remaining mapped units. Shared primitives remain global (Approach A). App keeps orchestration state; pages/components receive props/callbacks.

### 2.2 Pages

| Current | Target | Public export |
| --- | --- | --- |
| `Login` | `pages/Login` | `Login` |
| `PhaseManager.tsx` (`PhasesPage`) | `pages/PhasesPage` | `PhasesPage` |
| `AutomationManager` | `pages/AutomationsPage` | `AutomationsPage` |
| `AgentOpsPage` | `pages/AgentOpsPage` | `AgentOpsPage` |

**Contracts (semantics unchanged; prop names may be typed in `types.ts`):**

- `Login`: `{ onLogin: (email, password) => Promise<void> }`
- `PhasesPage`: `{ project, phases, onChange }` as today
- `AutomationsPage`: `{ project, users, phases }` as today’s `AutomationManager`
- `AgentOpsPage`: `{ onOpenAgent?: (agentId: string) => void }` — Settings continues to pass `onOpenAgent`

### 2.3 Shell components

Folderize without renaming exports. `Sidebar` keeps supporting optional `className` / `onNavigate` for the mobile drawer pattern (global `mobile-sidebar` / `mobile-open` hooks may remain dual-class if App still applies them).

### 2.4 Modals

Folderize without renaming exports. Do not introduce a shared ModalShell; continue using global `.modal-backdrop` and shared button classes.

### 2.5 CSS ownership

**Move into modules:** selectors owned exclusively by the migrated units (login, sidebar, search palette, notification panel, multi-filter, project header actions, project/phase/logout modals, phases page, automations page, agent ops page), including mobile overrides that only target those selectors.

**Keep global for now (slice 6 candidates):**  
`.button*`, `.modal-backdrop`, `.modal-kicker`, `.form-error`, `.form-success`, status/priority/avatar tokens still shared, App shell layout (`.app-shell`, `.project-tabs`, `.content-area`, `.toolbar*`, mobile nav chrome owned by App), and any selector still referenced by unmigrated markup after inspection.

Inspect before deletion. Prefer dual-class global hooks only when App or third-party code requires a stable class name.

## 3. App & Settings wiring

```tsx
import { Login } from "./pages/Login";
import { PhasesPage } from "./pages/PhasesPage";
import { AutomationsPage } from "./pages/AutomationsPage";
import { Sidebar } from "./components/Sidebar";
// ... other folderized components

{view === "automations" && <AutomationsPage key={currentProject?.id} project={currentProject} users={allUsers} phases={phases} />}
{view === "phases" ? <PhasesPage ... /> : ...}
```

`SettingsPage` updates:

```tsx
import { AgentOpsPage } from "../AgentOpsPage"; // → ../../pages/AgentOpsPage
```

Delete flat source files after rewiring.

## 4. Implementation order (commits inside one PR)

1. Pages: Login → PhasesPage → AutomationsPage → AgentOpsPage  
2. Shell: Sidebar, Avatar, NotificationPanel, SearchPalette, MultiFilterDropdown, ProjectHeaderActions  
3. Modals: Project*, Phase*, LogoutConfirm  
4. Purge leftover migrated selectors + root version bump

## 5. Testing & verification

- Structure/export tests for each new page/component unit and App/Settings import paths
- Assertion that a representative set of migrated selectors is absent from `styles.css` after purge
- `npm run test -w @taskforge/web`
- `npm run typecheck -w @taskforge/web`
- `npm run build -w @taskforge/web`
- Manual smoke: login, sidebar/home/settings, search, notifications, phases, automations, project create/edit/members/delete, phase delete/merge, logout confirm, agent ops from Settings
- Root version bump `0.1.26` → `0.1.27`

## 6. Success criteria

- Remaining pages and chrome/modals live in folder units with CSS Modules
- `AutomationsPage` rename and `PhasesPage` path update complete; App/Settings imports updated
- Migrated global CSS removed; shared button/modal/status primitives preserved
- No intentional product regressions

## 7. Follow-ups (not this PR)

- Final `styles.css` retirement / leftover shared primitives (slice 6)
- Optional later extraction of shared ModalShell if duplication justifies it
