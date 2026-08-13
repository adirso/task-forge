# Dashboard — Design Spec
**Date:** 2026-08-13  
**Status:** Approved

## Overview

A freeform, drag & drop home dashboard shown when no project is selected. Users can add, reposition, and remove widgets that surface cross-project data. Layout is persisted per browser in `localStorage`.

---

## 1. Entry Point

The dashboard replaces the existing empty state in `App.tsx` rendered when `!currentProject && !showSettings`. A "Home" link is added to the top of the sidebar to make it explicitly navigable (clicking it deselects the current project).

No new URL route is added — the dashboard is the default state when no `?project=` param is set.

---

## 2. Widget System

### 2.1 WidgetShell

A shared wrapper used by all widget types:

- **Drag handle:** the entire card header (`cursor: grab`, `cursor: grabbing` while dragging)
- **Header content:** icon + widget name (left) + close × button (right)
- **Content area:** scrollable, fixed min/max height per widget type
- **Positioning:** absolutely positioned on the canvas via `react-draggable`
- **z-index:** widget being dragged is brought to front

### 2.2 Widget Types

| ID | Name | Data source | Default size |
|---|---|---|---|
| `project_status` | Project status | `GET /api/dashboard/summary` → `projects` | 360 × 280 |
| `project_progress` | Project progress | `GET /api/dashboard/summary` → `projects` | 360 × 260 |
| `my_tasks` | My tasks | `GET /api/dashboard/summary` → `myTasks` | 360 × 320 |
| `stuck_tasks` | Stuck tasks | `GET /api/dashboard/summary` → `stuckTasks` | 360 × 280 |
| `activity` | Recent activity | `GET /api/activity?limit=20` | 380 × 360 |
| `agent_ops` | Agent ops | `GET /api/users/agents/ops` (admin only) | 560 × 400 |

Each widget:
- Fetches its own data on mount and on a manual refresh
- Shows a loading skeleton while fetching
- Shows an inline error state with retry on failure
- Task rows are clickable (navigate to `?project=KEY&task=KEY-N`)

### 2.3 Widget Picker

A floating **"+ Add widget"** button (bottom-right corner of the canvas). Clicking opens a compact panel listing all 6 widget types with an icon and short description. Clicking a type:

1. Creates a new widget instance with a unique ID
2. Places it at `{ x: 24 + (instanceCount * 16), y: 24 + (instanceCount * 16) }` to cascade rather than stack exactly
3. Saves the updated layout to localStorage
4. Closes the picker

Multiple instances of the same widget type are allowed (e.g., two activity feeds).

---

## 3. Layout Persistence

### 3.1 Storage key

`localStorage['taskforge_dashboard']`

### 3.2 Schema

```ts
interface DashboardLayout {
  widgets: WidgetInstance[];
}

interface WidgetInstance {
  id: string;           // nanoid, e.g. "w_abc123"
  type: WidgetType;
  x: number;
  y: number;
}
```

### 3.3 Default layout

On first visit (no saved layout), two widgets are pre-placed:
- `project_status` at `{ x: 24, y: 24 }`
- `my_tasks` at `{ x: 408, y: 24 }`

### 3.4 Persistence triggers

- Widget added → save
- Widget removed → save
- Drag stop → save (react-draggable `onStop` callback)

---

## 4. Backend

### 4.1 New endpoint: `GET /api/dashboard/summary`

Returns a single bundle used by project-status, project-progress, my-tasks, and stuck-tasks widgets.

**Access:** any authenticated user (HUMAN or AGENT with token).

**Response:**
```ts
{
  projects: Array<{
    id: string;
    name: string;
    key: string;
    counts: { TODO: number; IN_PROGRESS: number; DONE: number };
  }>;
  myTasks: Array<{
    id: string;
    number: number;
    title: string;
    projectKey: string;
    status: TaskStatus;
  }>;
  stuckTasks: Array<{
    id: string;
    number: number;
    title: string;
    projectKey: string;
    assigneeName: string | null;
  }>;
}
```

**Implementation notes:**
- `projects` — projects the requesting user is a member of, with task counts per status via a `GROUP BY` query
- `myTasks` — tasks where `assignee_id = requestingUser.id` and `status != 'DONE'`, ordered by `updated_at DESC`, limit 20
- `stuckTasks` — tasks where `status = 'IN_PROGRESS'` and `updated_at < now - 4h`, across all projects the user is a member of, limit 20

### 4.2 Existing endpoints reused (no changes)

- `GET /api/activity?limit=20` — activity widget
- `GET /api/users/agents/ops` — agent ops widget

---

## 5. Files

### New files

| Path | Purpose |
|---|---|
| `apps/web/src/components/DashboardPage.tsx` | Canvas, widget picker, layout management |
| `apps/web/src/components/WidgetShell.tsx` | Draggable wrapper + header + close button |
| `apps/web/src/components/widgets/ProjectStatusWidget.tsx` | TODO/IN_PROGRESS/DONE bars per project |
| `apps/web/src/components/widgets/ProjectProgressWidget.tsx` | Completion % bars |
| `apps/web/src/components/widgets/MyTasksWidget.tsx` | My open tasks across projects |
| `apps/web/src/components/widgets/StuckTasksWidget.tsx` | IN_PROGRESS tasks not updated 4h+ |
| `apps/web/src/components/widgets/ActivityWidget.tsx` | Recent activity feed |
| `apps/web/src/components/widgets/AgentOpsWidget.tsx` | Agent fleet summary (admin only) |
| `apps/web/src/lib/dashboard.ts` | Layout load/save helpers + default layout |
| `apps/api/src/routes/dashboard.ts` | `GET /api/dashboard/summary` handler |

### Modified files

| Path | Change |
|---|---|
| `apps/web/src/App.tsx` | Render `DashboardPage` when `!currentProject && !showSettings` |
| `apps/web/src/components/Sidebar.tsx` | Add "Home" nav item that deselects current project |
| `apps/web/src/lib/api.ts` | Add `dashboardSummary()` method |
| `apps/api/src/app.ts` | Register `dashboardRoutes` at `/api/dashboard` |
| `apps/web/src/styles.css` | Dashboard + widget styles |
| `packages/contracts/src/index.ts` | `DashboardSummary` interface |

### Dependency added

`react-draggable` — frontend only, ~10 kB, no peer deps.

---

## 6. Error handling & edge cases

- **No projects:** project-status and progress widgets show an empty state prompting the user to create a project.
- **Agent ops (non-admin):** widget shows a "Admins only" placeholder instead of data.
- **Widget overflow:** canvas has `min-height: 100vh` and grows vertically; widgets dragged off the left/top edge snap back to `x=0` / `y=0` on drag stop.
- **Corrupt localStorage:** catches JSON parse errors and resets to default layout.
