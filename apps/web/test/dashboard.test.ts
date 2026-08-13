import assert from "node:assert/strict";
import test from "node:test";
import { findNextSlot, normalizeLayout } from "../src/lib/dashboard.js";

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
  assert.equal(layout.widgets[0]?.type, "project_status");
  assert.equal(layout.widgets[0]?.w, 6);
  assert.equal(layout.widgets[1]?.type, "my_tasks");
  assert.ok((layout.widgets[0]?.x ?? 99) < 12);
});

test("keeps a valid grid layout", () => {
  const layout = normalizeLayout({
    version: 2,
    widgets: [{ id: "w1", type: "activity", x: 0, y: 2, w: 4, h: 5 }],
  });
  assert.deepEqual(layout.widgets, [{ id: "w1", type: "activity", x: 0, y: 2, w: 4, h: 5 }]);
});
