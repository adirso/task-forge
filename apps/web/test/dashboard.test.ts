import assert from "node:assert/strict";
import test from "node:test";
import { defaultLayout, findNextSlot, loadLayout, normalizeLayout, resetLayout } from "../src/lib/dashboard.js";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return store;
}

test("finds the first empty slot on an empty canvas", () => {
  assert.deepEqual(findNextSlot([], 6, 4), { x: 0, y: 0 });
});

test("places a new widget beside an existing one when it fits", () => {
  assert.deepEqual(
    findNextSlot([{ x: 0, y: 0, w: 6, h: 4 }], 6, 4),
    { x: 6, y: 0 },
  );
});

test("wraps to the next row when the first row is full", () => {
  assert.deepEqual(
    findNextSlot([
      { x: 0, y: 0, w: 6, h: 4 },
      { x: 6, y: 0, w: 6, h: 4 },
    ], 6, 4),
    { x: 0, y: 4 },
  );
});

test("skips occupied cells and fills a gap", () => {
  assert.deepEqual(
    findNextSlot([
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 8, y: 0, w: 4, h: 3 },
    ], 4, 3),
    { x: 4, y: 0 },
  );
});

test("migrates old pixel layouts to the default grid layout", () => {
  const layout = normalizeLayout({
    widgets: [
      { id: "default_project_status", type: "project_status", x: 24, y: 24 },
      { id: "default_my_tasks", type: "my_tasks", x: 420, y: 24 },
    ],
  });
  assert.equal(layout.version, 2);
  assert.deepEqual(layout.widgets.map((widget) => widget.type), ["project_status", "my_tasks", "stuck_tasks", "activity"]);
  assert.ok((layout.widgets[0]?.x ?? 99) < 12);
});

test("keeps a valid grid layout", () => {
  const layout = normalizeLayout({
    version: 2,
    widgets: [{ id: "w1", type: "activity", x: 0, y: 2, w: 4, h: 5 }],
  });
  assert.deepEqual(layout.widgets, [{ id: "w1", type: "activity", x: 0, y: 2, w: 4, h: 5 }]);
});

test("default layout includes stuck tasks and activity for everyone", () => {
  const types = defaultLayout(false).widgets.map((widget) => widget.type);
  assert.deepEqual(types, ["project_status", "my_tasks", "stuck_tasks", "activity"]);
  assert.equal(types.includes("agent_ops"), false);
});

test("default layout adds agent ops for admins", () => {
  const types = defaultLayout(true).widgets.map((widget) => widget.type);
  assert.deepEqual(types, ["project_status", "my_tasks", "stuck_tasks", "activity", "agent_ops"]);
});

test("does not overwrite a saved custom layout", () => {
  const saved = {
    version: 2 as const,
    widgets: [{ id: "only_mine", type: "my_tasks" as const, x: 0, y: 0, w: 6, h: 5 }],
  };
  assert.deepEqual(normalizeLayout(saved, true), saved);
});

test("resetLayout restores the default widgets for members", () => {
  installMemoryStorage();
  const layout = resetLayout(false);
  assert.deepEqual(layout, defaultLayout(false));
  assert.deepEqual(loadLayout(false), defaultLayout(false));
});

test("resetLayout restores the default widgets including agent ops for admins", () => {
  installMemoryStorage();
  const layout = resetLayout(true);
  assert.deepEqual(layout, defaultLayout(true));
  assert.equal(layout.widgets.some((widget) => widget.type === "agent_ops"), true);
});

test("resetLayout overwrites a wrecked saved layout so the stored grid matches default", () => {
  const store = installMemoryStorage();
  store.set(
    "taskforge_dashboard",
    JSON.stringify({
      version: 2,
      widgets: [{ id: "wrecked", type: "activity", x: 9, y: 12, w: 3, h: 2 }],
    }),
  );
  const layout = resetLayout(false);
  assert.deepEqual(layout, defaultLayout(false));
  assert.deepEqual(JSON.parse(store.get("taskforge_dashboard")!), defaultLayout(false));
  assert.deepEqual(loadLayout(false), defaultLayout(false));
});
