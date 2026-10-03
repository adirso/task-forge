# Global stylesheet retirement — Slice Design

**Date:** 2026-10-03  
**Status:** Approved  
**Parent spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`  
**Slice:** 6 — Final `styles.css` retirement (Approach A, one PR)

## Overview

Retire the remaining monolithic `apps/web/src/styles.css` (~197 lines) by splitting it into a lasting shared globals entry and App/page-owned CSS Modules. No intentional product behavior changes. No ModalShell extraction.

## Goals

- Replace root `styles.css` with `styles/global.css` for reset, CSS variables, and shared primitives still used via string class names
- Move App-owned chrome (shell, project header/tabs, toolbar/filters, mobile topbar, toast, loading, content-area hooks) into `App.module.css` using Vite-safe `:global(.selector)` rules
- Move exclusive leftovers into owning page modules (`SettingsPage`, `AgentOpsPage`)
- Delete dead unused rules (`workspace-switch*`, `empty-project`)
- Preserve dual-class hooks (`automations-hidden`, toolbar/mobile `open`, etc.)
- Bump root version `0.1.27` → `0.1.28`

## Non-goals

- Product behavior changes
- Extracting `ModalShell` or rewriting call sites from `className="button"` to local module classes
- Relocating App tabs/toolbar ownership into page components (CSS move only)
- Changing vendor CSS imports (`react-grid-layout`, `react-resizable`)

## 1. Target tree

```
apps/web/src/
  main.tsx                    # import "./styles/global.css"
  App.tsx
  App.module.css              # App-owned chrome via :global(.…)
  styles/
    global.css                # reset, :root tokens, shared primitives
  pages/
    SettingsPage/…            # absorb settings-section* leftovers
    AgentOpsPage/…            # absorb ops-badge* / stuck-summary leftovers
    …
  styles.css                  # DELETE after move
```

## 2. Architecture

### 2.1 Approach

One PR. Shared primitives stay as global class strings (Approach A). App chrome becomes an App CSS Module that emits global selectors via `:global(.selector)` — **not** Sass-style `:global { }` blocks (Vite drops those).

### 2.2 Ownership map

| Bucket | Destination |
| --- | --- |
| `:root` tokens, element reset (`*`, `body`, `button`/`input` base) | `styles/global.css` |
| Shared primitives: `.button*`, `.modal-backdrop`, `.modal-kicker`, `@keyframes modal-in`, `.icon-button`, `.form-error`, `.form-success`, `.section-heading`, status/priority/tone/PR pills, `.muted`, `.task-key`, `.brand-lockup*`, `.brand-mark`, `.settings-notice` (Settings + ProjectMembersModal) | `styles/global.css` |
| App chrome: `.app-shell`, `.workspace`, `.project-header*`, breadcrumbs/title/logo, `.header-actions`, `.project-tabs`, `.content-toolbar`, `.search-field`, `.select-wrap`, estimate/clear/toolbar filters, `.content-area`, `.automations-hidden`, mobile topbar/scrim/filter toggle/header buttons, `.toast` + `@keyframes toast-in`, `.loading-screen`, `.loading-mark`, `@keyframes spin` (if only used by loading), related `@media` fragments | `App.module.css` via `:global(.…)` |
| `.settings-section`, `.settings-section-heading` | `SettingsPage` module |
| `.ops-badge*`, `.ops-task-*`, `.stuck-summary` | `AgentOpsPage` module |
| `.workspace-switch*`, `.workspace-icon`, `.empty-project` | Delete (unused) |

Inspect before deletion. If a selector is still referenced after inspection, keep it in the appropriate owner.

### 2.3 CSS Modules rules

- Prefer `:global(.class)` / `:global(.a), :global(.b)` per rule
- Nest media queries as `@media … { :global(.class) { … } }`
- Do **not** use block wrappers `:global { … }` (broken under Vite)
- Keep `main.tsx` importing plain `styles/global.css` (not a CSS Module)

### 2.4 Dual-class hooks

Preserve App-applied string classes such as `automations-hidden`, `dashboard-hidden` (if styled), toolbar `open`, mobile filter toggle `open`. CSS for those hooks moves with App chrome.

## 3. Wiring

```tsx
// main.tsx
import "./styles/global.css";

// App.tsx
import styles from "./App.module.css";
// root element includes styles.root so the module loads
```

Delete `apps/web/src/styles.css` after all rules are relocated or removed.

## 4. Implementation order (commits inside one PR)

1. Create `styles/global.css` with reset/tokens/shared primitives; point `main.tsx` at it  
2. Extract App chrome into `App.module.css`; wire `styles.root`  
3. Move Settings/AgentOps exclusive leftovers into those page modules  
4. Delete dead rules + delete `styles.css`  
5. Export/purge tests + version bump `0.1.27` → `0.1.28`

## 5. Testing & verification

- Structure test: `styles/global.css` exists; root `styles.css` absent
- Assertion: App-exclusive and page-exclusive selectors are not in `styles/global.css`
- Assertion: migrated modules do not use block `:global { }`
- `npm run test -w @taskforge/web`
- `npm run typecheck -w @taskforge/web`
- `npm run build -w @taskforge/web` (confirm `.sidebar`, `.button`, `.app-shell`, `.project-tabs` present in bundle)
- Manual smoke: login, shell/mobile nav, board/list toolbar filters, settings notice, agent ops badges, toast, loading screen, modals/buttons

## 6. Success criteria

- Root `styles.css` removed
- Shared primitives live in `styles/global.css`
- App chrome and page leftovers live in owning modules
- No intentional product regressions; Vite emits the moved selectors

## 7. Follow-ups (not this PR)

- Optional later `ModalShell` if modal markup duplication justifies it
- Optional later conversion of string `button` / status classes to local module classes
