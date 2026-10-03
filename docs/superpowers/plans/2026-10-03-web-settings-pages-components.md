# Settings pages/components migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Settings into `pages/SettingsPage/` with CSS Modules, local `parts/`, and folderized Settings-owned components, without changing product behavior.

**Architecture:** Follow Approach A from the design spec: pages vs components, each unit owns `tsx` + `*.module.css` + `types.ts` + `index.ts`. Settings-only sub-UI lives under `parts/`. Shared Settings building blocks become top-level `components/<Name>/` folders. Legacy `styles.css` keeps global primitives (`.button`, `.form-error`) and unmigrated screens; Settings-specific selectors are removed after extraction.

**Tech Stack:** React 19, Vite 6 (native CSS Modules via `*.module.css`), TypeScript, existing Node test runner (`tsx --test`), `@taskforge/contracts`

**Spec:** `docs/superpowers/specs/2026-10-03-web-pages-components-design.md`

## Global Constraints

- No intentional product behavior changes (tabs, URL persistence, new-agent button, token reveal modal must keep working)
- CSS Modules only for migrated units (`*.module.css`); no new Settings rules in root `styles.css`
- Public export name `SettingsPage` stays stable for `App.tsx`
- `parts/` are private to their parent; do not import them from outside
- Shared helpers stay in `src/lib/` (no JSX/CSS there)
- PRs targeting `main` must bump root `package.json` + `package-lock.json` version
- Verify every task with the commands listed in that task

## Review Focus

- Refresh on `?settings=agents&agent=…&agentTab=deliveries` still restores the same Settings + agent detail tabs after the move
- New-agent form remains hidden until the header/empty-state button opens it
- Reveal-token flow still uses the React modal (not `window.confirm`) after `RevealTokenConfirmModal` is folderized
- Access tab still excludes delivery history; Deliveries tab still owns retry/list UI
- Migrated Settings UI does not regress to unstyled/broken layout because a selector was left behind in global CSS or missed in a module

## File map (end state for this PR)

```
apps/web/src/
  App.tsx                                      # import from pages/SettingsPage
  styles.css                                   # Settings-specific rules removed
  pages/
    SettingsPage/
      SettingsPage.tsx
      SettingsPage.module.css
      types.ts
      index.ts
      parts/
        AccountSection/
        AppearanceSection/
        AgentsSection/
          AgentsSection.tsx
          AgentsSection.module.css
          types.ts
          index.ts
          parts/
            NewAgentForm/
            AgentPicker/
            AgentDetail/
              AgentDetail.tsx
              AgentDetail.module.css
              types.ts
              index.ts
              parts/
                IdentityPanel/
                AccessPanel/
                DeliveriesPanel/   # thin wrapper around WebhookDeliveriesPanel
                RoutingPanel/      # thin wrapper around AgentCapabilityEditor
                DangerPanel/
        BackupSection/
  components/
    WebhookManager/{WebhookManager.tsx,WebhookManager.module.css,types.ts,index.ts}
    WebhookDeliveriesPanel/{…}
    RevealTokenConfirmModal/{…}
    AgentCapabilityEditor/{…}
    Avatar.tsx                                 # unchanged this PR (still flat)
    AgentOpsPage.tsx                           # unchanged this PR (still flat/global CSS)
```

---

### Task 1: Scaffold Settings page unit and rewire App import

**Files:**
- Create: `apps/web/src/pages/SettingsPage/types.ts`
- Create: `apps/web/src/pages/SettingsPage/SettingsPage.module.css`
- Create: `apps/web/src/pages/SettingsPage/SettingsPage.tsx`
- Create: `apps/web/src/pages/SettingsPage/index.ts`
- Modify: `apps/web/src/App.tsx` (SettingsPage import path only)
- Modify: `apps/web/test/agentSettings.test.ts` (keep constant; add comment pointing at new path)
- Delete after move: `apps/web/src/components/SettingsPage.tsx`

**Interfaces:**
- Consumes: existing `SettingsPage` props from `App.tsx`
- Produces: `export function SettingsPage(props: SettingsPageProps): JSX.Element` from `pages/SettingsPage`

- [ ] **Step 1: Add a path/export contract test**

Create `apps/web/test/settingsPageExport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("App imports SettingsPage from pages/SettingsPage", () => {
  const app = readFileSync(resolve("src/App.tsx"), "utf8");
  assert.match(app, /from ["']\.\/pages\/SettingsPage["']/);
  assert.doesNotMatch(app, /from ["']\.\/components\/SettingsPage["']/);
});

test("SettingsPage unit exposes the required co-located files", () => {
  const root = resolve("src/pages/SettingsPage");
  for (const file of ["index.ts", "SettingsPage.tsx", "SettingsPage.module.css", "types.ts"]) {
    assert.equal(readFileSync(resolve(root, file), "utf8").length > 0, true, file);
  }
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='SettingsPage'`
Expected: FAIL because `pages/SettingsPage` does not exist / App still imports components path

- [ ] **Step 3: Create the page unit by moving the current file**

`types.ts`:

```ts
import type { User } from "@taskforge/contracts";

export type SettingsPageProps = {
  user: User;
  users: User[];
  defaultView: "board" | "list";
  textSize: "comfortable" | "large";
  onUserUpdated: (user: User) => void;
  onAgentCreated: (user: User) => void;
  onAgentUpdated: (user: User) => void;
  onAgentDeleted: (id: string) => void;
  onDefaultViewChange: (view: "board" | "list") => void;
  onTextSizeChange: (size: "comfortable" | "large") => void;
};
```

`index.ts`:

```ts
export { SettingsPage } from "./SettingsPage";
export type { SettingsPageProps } from "./types";
```

`SettingsPage.tsx`:
- Move current `components/SettingsPage.tsx` content here
- Change relative imports:
  - `../lib/...` → `../../lib/...`
  - `./Avatar` → `../../components/Avatar`
  - `./AgentOpsPage` → `../../components/AgentOpsPage`
  - `./WebhookManager` → `../../components/WebhookManager`
  - `./WebhookDeliveriesPanel` → `../../components/WebhookDeliveriesPanel`
  - `./AgentCapabilityEditor` → `../../components/AgentCapabilityEditor`
  - `./RevealTokenConfirmModal` → `../../components/RevealTokenConfirmModal`
- Keep using legacy global className strings for now (no visual change yet)
- Type the props with `SettingsPageProps`
- Add `import styles from "./SettingsPage.module.css";` and apply `styles.root` on the outermost wrapper **in addition to** keeping `settings-page` temporarily if needed — preferred: outermost uses only `styles.root` once CSS is copied in Task 2. For Task 1, leave classNames unchanged so behavior stays green.

`SettingsPage.module.css`: start with an empty file or a comment placeholder `/* extracted in later tasks */`

Update `App.tsx`:

```ts
import { SettingsPage } from "./pages/SettingsPage";
```

Delete `apps/web/src/components/SettingsPage.tsx`.

- [ ] **Step 4: Run tests/typecheck**

Run:
```bash
npm run test -w @taskforge/web -- --test-name-pattern='SettingsPage|agents settings|settingsNav'
npm run typecheck -w @taskforge/web
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage apps/web/src/App.tsx apps/web/test/settingsPageExport.test.ts apps/web/test/agentSettings.test.ts
git rm apps/web/src/components/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
refactor(web): move SettingsPage into pages unit

Establish the pages/SettingsPage folder shape and rewire App to the barrel export.
EOF
)"
```

---

### Task 2: Extract Settings shell CSS Modules + Account/Appearance parts

**Files:**
- Create: `apps/web/src/pages/SettingsPage/parts/AccountSection/{AccountSection.tsx,AccountSection.module.css,types.ts,index.ts}`
- Create: `apps/web/src/pages/SettingsPage/parts/AppearanceSection/{AppearanceSection.tsx,AppearanceSection.module.css,types.ts,index.ts}`
- Modify: `apps/web/src/pages/SettingsPage/SettingsPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage/SettingsPage.module.css`
- Modify: `apps/web/src/styles.css` (remove extracted Settings shell/account/appearance selectors)

**Interfaces:**
- Consumes: `SettingsPageProps` fields for account/appearance
- Produces:
  - `AccountSection({ user, name, email, onNameChange, onEmailChange, onSubmit })`
  - `AppearanceSection({ defaultView, textSize, onDefaultViewChange, onTextSizeChange })`

- [ ] **Step 1: Extend export/structure test for parts**

Add to `apps/web/test/settingsPageExport.test.ts`:

```ts
test("SettingsPage includes Account and Appearance parts", () => {
  for (const part of ["AccountSection", "AppearanceSection"]) {
    const base = resolve(`src/pages/SettingsPage/parts/${part}`);
    for (const file of [`${part}.tsx`, `${part}.module.css`, "types.ts", "index.ts"]) {
      assert.equal(readFileSync(resolve(base, file), "utf8").length > 0, true, `${part}/${file}`);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='Account and Appearance'`
Expected: FAIL (parts missing)

- [ ] **Step 3: Implement AccountSection and AppearanceSection with CSS Modules**

Move the existing Account and Appearance JSX blocks into the parts.
Copy matching CSS from `styles.css` into the part modules, converting selectors to camelCase module classes, e.g.:

```css
/* AccountSection.module.css */
.root { /* was .settings-section scoped content */ }
.heading { }
.form { }
.summary { }
```

In TSX:

```tsx
import styles from "./AccountSection.module.css";
// ...
<section className={styles.root}>...</section>
```

In `SettingsPage.module.css`, move page shell rules:
- `.settings-page` → `.root`
- `.settings-header` → `.header`
- `.settings-layout` → `.layout`
- `.settings-nav` → `.nav` (+ `:global` not needed; use `.navButton` / `.navButtonActive`)
- `.settings-content` → `.content`
- `.settings-message` can remain global if shared, or move to page module as `.message`

Update `SettingsPage.tsx` to render:

```tsx
{tab === "account" && (
  <AccountSection
    user={user}
    name={name}
    email={email}
    onNameChange={setName}
    onEmailChange={setEmail}
    onSubmit={saveProfile}
  />
)}
{tab === "appearance" && (
  <AppearanceSection
    defaultView={defaultView}
    textSize={textSize}
    onDefaultViewChange={onDefaultViewChange}
    onTextSizeChange={onTextSizeChange}
  />
)}
```

Delete the extracted selectors from `styles.css` (shell/account/appearance only). Keep `.button*`, `.form-error`, `.form-success` global.

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web -- --test-name-pattern='SettingsPage|Account and Appearance'
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual smoke: open Settings Account + Appearance and confirm layout/selection chrome still matches.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage apps/web/src/styles.css apps/web/test/settingsPageExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): extract Settings account and appearance parts

Move shell/account/appearance UI onto CSS Modules under pages/SettingsPage.
EOF
)"
```

---

### Task 3: Extract AgentsSection + NewAgentForm + AgentPicker + AgentDetail shell

**Files:**
- Create: `pages/SettingsPage/parts/AgentsSection/` (+ nested `parts/NewAgentForm`, `parts/AgentPicker`, `parts/AgentDetail`)
- Modify: `SettingsPage.tsx` to delegate agents tab state/handlers into `AgentsSection`
- Modify: `styles.css` to remove agent-manager/list/detail/new-agent selectors once moved

**Interfaces:**
- Consumes: agents list, selected agent, detail tab, token/avatar/webhook handlers currently in SettingsPage
- Produces: `AgentsSection` owning agents UI composition; parent keeps data fetching/mutations OR moves agent-only state into AgentsSection if it simplifies without changing behavior

Preferred split for this task:
- Keep mutation/state in `SettingsPage.tsx` for now
- Pass props into `AgentsSection`
- `AgentDetail` only switches tab panels; panel bodies can still be inline until Task 4/5

- [ ] **Step 1: Add structure assertions for Agents parts**

```ts
test("SettingsPage includes AgentsSection parts tree", () => {
  const required = [
    "parts/AgentsSection/AgentsSection.tsx",
    "parts/AgentsSection/parts/NewAgentForm/NewAgentForm.tsx",
    "parts/AgentsSection/parts/AgentPicker/AgentPicker.tsx",
    "parts/AgentsSection/parts/AgentDetail/AgentDetail.tsx",
  ];
  for (const rel of required) {
    assert.equal(readFileSync(resolve("src/pages/SettingsPage", rel), "utf8").length > 0, true, rel);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AgentsSection parts tree'`
Expected: FAIL

- [ ] **Step 3: Implement Agents parts with CSS Modules**

Extract:
- New agent header button + collapsible form → `NewAgentForm`
- Left agent list → `AgentPicker`
- Detail tabs chrome → `AgentDetail` (panels can remain temporarily in `AgentDetail.tsx` as local JSX)

Move CSS:
- `.agents-section-heading`, `.new-agent-*`, `.agent-empty-state`, `.agent-manager`, `.agent-list*`, `.agent-detail*`, `.agent-panel*`, `.agent-identity*`, `.select-agent-empty`

Keep using existing behavior:
- form hidden until opened
- selecting agent resets detail tab to identity when user clicks a different agent
- URL sync remains in parent `SettingsPage`

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual smoke: Agents tab list/selection/new-agent open-close/detail tabs.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage apps/web/src/styles.css apps/web/test/settingsPageExport.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): extract Settings agents section parts

Split agents list, new-agent form, and detail chrome into SettingsPage parts with CSS Modules.
EOF
)"
```

---

### Task 4: Folderize Settings-owned shared components with CSS Modules

**Files:**
- Move/create:
  - `components/WebhookManager/`
  - `components/WebhookDeliveriesPanel/`
  - `components/RevealTokenConfirmModal/`
  - `components/AgentCapabilityEditor/`
- Update imports in `pages/SettingsPage/**`
- Remove corresponding global CSS (webhook/token/reveal-token/agent-capability) from `styles.css`
- Keep `.issued-token` / `.token-*` either in `AccessPanel` module (Task 5) or temporarily in `WebhookManager` only if still shared — prefer AccessPanel in Task 5; for this task move webhook + reveal + capability CSS

**Interfaces:**
- Public exports remain:
  - `export { WebhookManager } from "./WebhookManager"`
  - same for the other three
- Props types move into each unit’s `types.ts`

- [ ] **Step 1: Add import-path contract test**

```ts
test("Settings-owned shared components are folder units", () => {
  for (const name of [
    "WebhookManager",
    "WebhookDeliveriesPanel",
    "RevealTokenConfirmModal",
    "AgentCapabilityEditor",
  ]) {
    const index = readFileSync(resolve(`src/components/${name}/index.ts`), "utf8");
    assert.match(index, new RegExp(`export \\{ ${name} \\}`));
    assert.equal(readFileSync(resolve(`src/components/${name}/${name}.module.css`), "utf8").length > 0, true);
  }
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='folder units'`
Expected: FAIL

- [ ] **Step 3: Move each component into its folder + CSS Modules**

For each component:
1. Create folder + `types.ts` + `index.ts` + `Name.module.css` + `Name.tsx`
2. Replace global class strings with `styles.*`
3. Delete old flat `components/Name.tsx`
4. Update Settings imports to `../../components/Name` (barrel still works)
5. For `RevealTokenConfirmModal`, copy the dialog shell styles it currently borrows from `.logout-modal` into its module (do not break `LogoutConfirmModal`, which stays on global `.logout-modal` this PR)

- [ ] **Step 4: Verify**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual smoke: Access webhook save/rotate UI, Deliveries list/retry, Routing capabilities form, Reveal token modal.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WebhookManager apps/web/src/components/WebhookDeliveriesPanel apps/web/src/components/RevealTokenConfirmModal apps/web/src/components/AgentCapabilityEditor apps/web/src/pages/SettingsPage apps/web/src/styles.css apps/web/test/settingsPageExport.test.ts
git rm apps/web/src/components/WebhookManager.tsx apps/web/src/components/WebhookDeliveriesPanel.tsx apps/web/src/components/RevealTokenConfirmModal.tsx apps/web/src/components/AgentCapabilityEditor.tsx
git commit -m "$(cat <<'EOF'
refactor(web): folderize Settings shared components with CSS Modules

Move webhook, deliveries, reveal-token, and capability editor into component units with co-located styles.
EOF
)"
```

---

### Task 5: Finish AgentDetail panels + BackupSection; purge leftover Settings CSS; version bump

**Files:**
- Create: `AgentDetail/parts/{IdentityPanel,AccessPanel,DeliveriesPanel,RoutingPanel,DangerPanel}/…`
- Create: `pages/SettingsPage/parts/BackupSection/…`
- Modify: `AgentDetail.tsx`, `SettingsPage.tsx`
- Modify: `styles.css` — remove remaining Settings/backup/token selectors migrated here
- Modify: `package.json`, `package-lock.json` version bump
- Modify: design/plan status notes only if needed

**Interfaces:**
- `AccessPanel` composes `WebhookManager` + token issue/list UI + opens `RevealTokenConfirmModal` via parent callbacks or local callback props
- `DeliveriesPanel` renders `WebhookDeliveriesPanel`
- `RoutingPanel` renders `AgentCapabilityEditor embedded`
- `BackupSection` owns backup cards UI

- [ ] **Step 1: Add final structure assertions**

```ts
test("SettingsPage AgentDetail panels and BackupSection exist", () => {
  const files = [
    "parts/AgentsSection/parts/AgentDetail/parts/AccessPanel/AccessPanel.tsx",
    "parts/AgentsSection/parts/AgentDetail/parts/DeliveriesPanel/DeliveriesPanel.tsx",
    "parts/BackupSection/BackupSection.tsx",
  ];
  for (const rel of files) {
    assert.equal(readFileSync(resolve("src/pages/SettingsPage", rel), "utf8").length > 0, true, rel);
  }
});
```

Also assert legacy Settings selectors are gone from global CSS:

```ts
test("legacy Settings selectors were removed from global styles", () => {
  const css = readFileSync(resolve("src/styles.css"), "utf8");
  for (const selector of [".settings-page", ".agent-manager", ".webhook-deliveries", ".new-agent-form", ".backup-card"]) {
    assert.equal(css.includes(selector), false, selector);
  }
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm run test -w @taskforge/web -- --test-name-pattern='AgentDetail panels|legacy Settings selectors'`
Expected: FAIL

- [ ] **Step 3: Implement remaining parts and purge CSS**

- Split AgentDetail panel bodies into parts with modules (token/issued-token CSS goes to `AccessPanel.module.css`)
- Extract Backup section
- Keep Agent ops tab rendering existing flat `AgentOpsPage` (out of scope to migrate)
- Remove migrated selectors from `styles.css`
- Bump root version (current on main after prior merge: read `package.json` and increment patch)

- [ ] **Step 4: Full verification**

Run:
```bash
npm run test -w @taskforge/web
npm run typecheck -w @taskforge/web
npm run build -w @taskforge/web
```
Expected: PASS

Manual checklist:
- [ ] Account / Appearance / Agents / Backup / Agent ops tabs
- [ ] Refresh keeps `settings` + `agent` + `agentTab`
- [ ] New agent button/form
- [ ] Reveal token modal
- [ ] Deliveries list scroll/retry
- [ ] No obvious unstyled Settings regions

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage apps/web/src/styles.css apps/web/test/settingsPageExport.test.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
refactor(web): finish Settings CSS Modules migration

Extract remaining Settings panels, purge legacy Settings selectors, and bump the release version.
EOF
)"
```

---

## Self-review notes

- Spec coverage: Settings-first slice, CSS Modules, pages/parts/components rules, incremental migration, shared Settings children folderized, `lib/` untouched, verification commands included
- Later slices (Task modal, Board/List, Dashboard) intentionally excluded from this plan
- `AgentOpsPage` remains flat/global in this PR by design
- No TBD/placeholder steps remain
