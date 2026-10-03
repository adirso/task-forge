# Task modal components migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `TaskModal` and related task UI into folderized component units with CSS Modules and private `parts/`, without changing product behavior.

**Architecture:** Follow Approach A from the design spec. `TaskModal` stays under `components/` (not `pages/`). Large tab bodies become private `parts/`. Shared task helpers (`TaskTags`, `TaskDependencies`, `TaskTypePill`, `SendToAI`) become top-level `components/<Name>/` folders. Legacy `styles.css` keeps shared modal primitives used by unmigrated `ProjectModal`/login; TaskModal-specific selectors are removed after extraction.

**Tech Stack:** React 19, Vite 6 (`*.module.css`), TypeScript, Node test runner (`tsx --test`), `@taskforge/contracts`

**Spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`  
**Approved slice design:** Task modal + related task parts (2026-10-03)

## Global Constraints

- No intentional product behavior changes (tabs, create/edit/delete, attachments, Send to AI, plans review, agent run controls)
- CSS Modules only for migrated units; no new TaskModal rules in root `styles.css`
- Public export names stay stable: `TaskModal`, `TaskTagPills`, `TaskTagEditor`, `TaskDependencyPills`, `TaskDependencyEditor`, `TaskTypePill`, `SendToAI`
- `parts/` are private to `TaskModal`; do not import them from Board/List/`App`
- Shared helpers stay in `src/lib/` (no JSX/CSS there)
- Leave `TaskCard` / Board / List page migration for the next slice (they may keep importing folderized `TaskTags` / `TaskDependencies` / `TaskTypePill` barrels)
- Shared selectors also used by `ProjectModal` / `.login-card` (for example `.modal-backdrop`, combined `.task-modal, .project-modal` shell rules) must remain or be carefully split so ProjectModal does not unstyle
- PRs targeting `main` must bump root `package.json` + `package-lock.json` version
- Verify every task with the commands listed in that task

## Review Focus

- Opening an existing task and a new-task modal still works; save/create/delete unchanged
- Details / Updates / Plans / Agents tabs still switch and disable correctly when creating a new task
- Attachments drag/drop/browse/download/remove still works on Details
- Send to AI still opens from the header and closes without breaking the parent modal
- Plans approve/reject and Agents run controls / force-cycle still work for authorized users
- Migrated UI does not regress to unstyled/broken layout because a selector was left behind in global CSS or missed in a module
- `TaskCard` / `ListView` still render tag/dependency/type pills after `TaskTags` / `TaskDependencies` / `TaskTypePill` are folderized

## File map (end state for this PR)

```
apps/web/src/
  App.tsx                                      # import from components/TaskModal
  styles.css                                   # TaskModal/SendToAI/task-tag editor CSS removed or reduced
  components/
    TaskModal/
      TaskModal.tsx
      TaskModal.module.css
      types.ts
      index.ts
      parts/
        DetailsPanel/
        UpdatesPanel/
        PlansPanel/
        AgentsPanel/
    TaskTags/{TaskTags.tsx,TaskTags.module.css,types.ts,index.ts}
    TaskDependencies/{…}
    TaskTypePill/{…}
    SendToAI/{…}
    TaskCard.tsx                               # still flat; imports updated barrels only
    ListView.tsx                               # import path update only
```

---

### Task 1: Scaffold TaskModal unit and rewire App import

**Files:**
- Create: `apps/web/src/components/TaskModal/types.ts`
- Create: `apps/web/src/components/TaskModal/TaskModal.module.css` (minimal shell placeholder OK)
- Create: `apps/web/src/components/TaskModal/TaskModal.tsx` (move current implementation; keep global class strings initially)
- Create: `apps/web/src/components/TaskModal/index.ts`
- Modify: `apps/web/src/App.tsx` (`./components/TaskModal`)
- Delete: `apps/web/src/components/TaskModal.tsx`

**Interfaces:**
- Consumes: existing `TaskModal` props from `App.tsx`
- Produces: `export function TaskModal(props: TaskModalProps): JSX.Element` from `components/TaskModal`

- [ ] **Step 1: Add a path/export contract test**

Create `apps/web/test/taskModalExport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("App imports TaskModal from components/TaskModal", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/components\/TaskModal["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/TaskModal\.tsx["']/);
});

test("TaskModal unit exposes the required co-located files", () => {
  const root = resolve("src/components/TaskModal");
  for (const file of ["index.ts", "TaskModal.tsx", "TaskModal.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='TaskModal unit|imports TaskModal'`
Expected: FAIL (folder missing)

- [ ] **Step 3: Move TaskModal into folder unit**

1. Create `types.ts` with `TaskModalProps` matching current inline props
2. Move implementation into `TaskModal/TaskModal.tsx` using those props
3. Keep temporary global class names (`task-modal`, etc.) — CSS Modules wiring is Task 4/5
4. Add empty-or-minimal `TaskModal.module.css` with a comment `/* shell styles arrive in Task 4 */` or a unused-safe placeholder class if the file must be non-empty for the test
5. Export from `index.ts`: `export { TaskModal } from "./TaskModal"; export type { TaskModalProps } from "./types";`
6. Update `App.tsx` import to `./components/TaskModal`
7. Delete flat `components/TaskModal.tsx`
8. Temporarily keep relative imports to flat siblings (`./SendToAI`, `./TaskTags`, `./TaskDependencies`, `./Avatar`)

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web -- --test-name-pattern='TaskModal'
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TaskModal apps/web/src/App.tsx apps/web/test/taskModalExport.test.ts
git rm apps/web/src/components/TaskModal.tsx
git commit -m "$(cat <<'EOF'
refactor(web): move TaskModal into component unit

Scaffold co-located TaskModal folder and rewire App imports without behavior changes.
EOF
)"
```

---

### Task 2: Folderize TaskTags, TaskDependencies, and TaskTypePill with CSS Modules

**Files:**
- Create: `components/TaskTags/`, `components/TaskDependencies/`, `components/TaskTypePill/`
- Modify: `TaskModal/TaskModal.tsx`, `TaskCard.tsx`, `ListView.tsx` imports
- Modify: `styles.css` — move tag/dependency/type pill + editor CSS into modules
- Delete: flat `TaskTags.tsx`, `TaskDependencies.tsx`, `TaskTypePill.tsx`

**Interfaces:**
- Public exports remain:
  - `TaskTagPills`, `TaskTagEditor`
  - `TaskDependencyPills`, `TaskDependencyEditor`
  - `TaskTypePill`
- Props move into each unit’s `types.ts`

- [ ] **Step 1: Extend structure test**

Append to `apps/web/test/taskModalExport.test.ts`:

```ts
test("task helper components are folder units", () => {
  for (const name of ["TaskTags", "TaskDependencies", "TaskTypePill"]) {
    const index = readFileSync(resolve(`src/components/${name}/index.ts`), "utf8");
    assert.match(index, new RegExp(`export \\{`));
    assert.equal(readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8").length > 0, true);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='task helper components'`
Expected: FAIL

- [ ] **Step 3: Implement folder units**

For each helper:
1. Create folder + `types.ts` + `index.ts` + `Name.module.css` + `Name.tsx`
2. Move pill/editor styles from `styles.css` into the module (including `.task-tag*`, `.selected-task-tags*`, `.task-dependency*`, `.dependency-*`, `.task-type` / type-pill rules as applicable)
3. Replace class strings with `styles.*`
4. Update imports in `TaskModal`, `TaskCard`, `ListView` to `./TaskTags` (barrel still works from sibling folders: `../TaskTags` from inside TaskModal)
5. Delete old flat files

Note: `.task-card > .task-tag-list` style currently couples card layout to tag list. Prefer moving the margin into `TaskCard` later; for this task, either:
- keep a tiny global shim `.task-card > …` temporarily, or
- wrap pills so TaskCard can add a local class later.
Prefer a temporary global shim comment `/* removed when TaskCard migrates */` only if needed; otherwise adjust TaskCard with a local className wrapper without full TaskCard migration.

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
git add apps/web/src/components/TaskTags apps/web/src/components/TaskDependencies apps/web/src/components/TaskTypePill apps/web/src/components/TaskModal apps/web/src/components/TaskCard.tsx apps/web/src/components/ListView.tsx apps/web/src/styles.css apps/web/test/taskModalExport.test.ts
git rm apps/web/src/components/TaskTags.tsx apps/web/src/components/TaskDependencies.tsx apps/web/src/components/TaskTypePill.tsx
git commit -m "$(cat <<'EOF'
refactor(web): folderize task tag, dependency, and type pill components

Move shared task pill/editor UI into component units with CSS Modules.
EOF
)"
```

---

### Task 3: Folderize SendToAI with CSS Modules

**Files:**
- Create: `components/SendToAI/`
- Modify: `TaskModal/TaskModal.tsx` import
- Modify: `styles.css` — move `.send-to-ai-*` and AI prompt/provider grid rules owned by SendToAI
- Delete: flat `SendToAI.tsx`

**Interfaces:**
- Produces: `export { SendToAI } from "./SendToAI"` with props in `types.ts`

- [ ] **Step 1: Add structure assertion**

```ts
test("SendToAI is a folder unit", () => {
  const index = readFileSync(resolve("src/components/SendToAI/index.ts"), "utf8");
  assert.match(index, /export \{ SendToAI \}/);
  assert.equal(readFileSync(resolve("src/components/SendToAI/SendToAI.module.css"), "utf8").length > 0, true);
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='SendToAI is a folder'`
Expected: FAIL

- [ ] **Step 3: Move SendToAI**

1. Create folder unit with CSS Modules for dialog shell, provider grid, prompt preview, footer
2. Keep using global `.modal-backdrop` or compose a SendToAI backdrop class that includes the same visuals (current `.send-to-ai-backdrop` extends backdrop behavior — move that into the module)
3. Update TaskModal import to `../SendToAI`
4. Delete flat file
5. Remove migrated selectors from `styles.css` and related mobile overrides that only target SendToAI

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
git add apps/web/src/components/SendToAI apps/web/src/components/TaskModal apps/web/src/styles.css apps/web/test/taskModalExport.test.ts
git rm apps/web/src/components/SendToAI.tsx
git commit -m "$(cat <<'EOF'
refactor(web): folderize SendToAI with CSS Modules

Move the Send to AI dialog into a component unit with co-located styles.
EOF
)"
```

---

### Task 4: Extract TaskModal parts (Details / Updates / Plans / Agents) + shell CSS Modules

**Files:**
- Create: `components/TaskModal/parts/{DetailsPanel,UpdatesPanel,PlansPanel,AgentsPanel}/…`
- Modify: `TaskModal.tsx`, `TaskModal.module.css`
- Modify: `styles.css` — move TaskModal-only shell/tab/panel CSS; leave ProjectModal-shared rules

**Interfaces:**
- Preferred: keep mutation/state and data loading in `TaskModal.tsx`; pass props into panels
- `DetailsPanel` owns form grid, attachments, PR editor, status-duration breakdown, routing control UI
- `UpdatesPanel` owns composer + updates list + activity log
- `PlansPanel` owns plan list / approve-reject
- `AgentsPanel` owns runs, artifacts, logs, force-cycle, empty state
- Local helpers (`activityLabel`, `formatBytes`, `StatusDurationBreakdown`, etc.) may live in the owning part or a private `TaskModal/helpers.ts` (not `lib/`)

- [ ] **Step 1: Add parts tree assertions**

```ts
test("TaskModal includes tab panel parts tree", () => {
  const required = [
    "parts/DetailsPanel/DetailsPanel.tsx",
    "parts/UpdatesPanel/UpdatesPanel.tsx",
    "parts/PlansPanel/PlansPanel.tsx",
    "parts/AgentsPanel/AgentsPanel.tsx",
  ];
  for (const rel of required) {
    assert.equal(readFileSync(resolve("src/components/TaskModal", rel), "utf8").length > 0, true, rel);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='tab panel parts'`
Expected: FAIL

- [ ] **Step 3: Implement parts + shell modules**

1. Extract each tab body into its part with a module
2. Convert TaskModal shell (`root` form, header, tabs, body, footer, send-to-ai header button, copy-link) to `TaskModal.module.css`
3. Carefully split CSS:
   - Move pure `.task-modal*` rules into the module
   - For combined selectors like `.task-modal label, .project-modal label`, duplicate needed rules under TaskModal module `.root label` and leave `.project-modal label` in global
   - Move details/updates/plans/agents panel CSS into the owning part modules (attachments, update-composer, plan-list, run-list, agent logs/artifacts, force-cycle, status duration, etc.)
4. Keep `.modal-backdrop`, `.modal-grid`, `.section-heading`, `.button*` global if still shared; if a class is TaskModal-only after inspection, move it

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual smoke: open task, switch all four tabs, post update, open Send to AI, upload attachment (if feasible in local env).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/TaskModal apps/web/src/styles.css apps/web/test/taskModalExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): extract TaskModal tab panels with CSS Modules

Split details, updates, plans, and agents into TaskModal parts and migrate shell styles.
EOF
)"
```

---

### Task 5: Purge leftover TaskModal selectors; version bump

**Files:**
- Modify: `styles.css` — remove remaining migrated TaskModal/SendToAI/task-editor selectors and dead mobile overrides
- Modify: `package.json`, `package-lock.json` — bump patch (`0.1.23` → `0.1.24`)
- Modify: `apps/web/test/taskModalExport.test.ts` — assert legacy selectors gone

**Interfaces:** none

- [ ] **Step 1: Add purge assertion**

```ts
test("legacy TaskModal selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles.css"), "utf8");
  for (const selector of [".task-modal-tabs", ".send-to-ai-dialog", ".task-tag-editor", ".attachment-dropzone", ".task-agents-empty"]) {
    assert.equal(css.includes(selector), false, selector);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='legacy TaskModal selectors'`
Expected: FAIL until purge complete (may already fail after Task 4 — finish any leftovers)

- [ ] **Step 3: Purge + bump**

1. Remove any remaining migrated selectors/media-query fragments
2. Confirm ProjectModal and login still have required global styles
3. Bump root version to `0.1.24` in `package.json` and both version fields in `package-lock.json`

- [ ] **Step 4: Full verification**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual checklist:
- [ ] New task create
- [ ] Edit existing task + save
- [ ] Details attachments
- [ ] Updates post
- [ ] Plans list (and approve/reject if data available)
- [ ] Agents tab empty + populated states
- [ ] Send to AI open/close
- [ ] Board/list cards still show tags/deps/type pills

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles.css apps/web/test/taskModalExport.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
refactor(web): finish TaskModal CSS Modules migration

Purge leftover TaskModal selectors from global styles and bump the release version.
EOF
)"
```

---

## Self-review notes

- Spec coverage: slice 2 (Task modal + related task parts), CSS Modules, components/`parts/` rules, incremental migration, `lib/` untouched, verification + version bump included
- Board/List/`TaskCard` full migration intentionally excluded; only import path + shared pill CSS ownership changes
- ProjectModal/login shared modal CSS carefully preserved
- No TBD/placeholder steps remain
