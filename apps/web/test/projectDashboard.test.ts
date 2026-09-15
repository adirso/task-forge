import assert from "node:assert/strict";
import test from "node:test";
import type { Task, Phase } from "@taskforge/contracts";
import { defaultProjectLayout, loadProjectLayout, normalizeProjectLayout, projectMetrics, saveProjectLayout } from "../src/lib/projectDashboard.js";

const now = Date.parse("2026-09-15T12:00:00Z");
const task = (overrides: Partial<Task>): Task => ({ id: "task", projectId: "p1", status: "TODO", priority: "MEDIUM", assigneeId: null, dependencies: [], statusDurations: {}, updatedAt: new Date(now).toISOString(), ...overrides } as Task);

test("metrics exclude other projects and closed work from priority, workload, and attention", () => {
  const metrics = projectMetrics("p1", [
    task({ id: "urgent", priority: "URGENT", dueDate: "2026-09-14", status: "IN_PROGRESS", updatedAt: "2026-09-15T08:00:00Z", statusDurations: { IN_PROGRESS: 120 } }),
    task({ id: "done", status: "DONE", dueDate: "2026-09-14", statusDurations: { IN_PROGRESS: 60 } }),
    task({ id: "cancelled", status: "CANCELLED", dueDate: "2026-09-14" }),
    task({ id: "foreign", projectId: "p2", priority: "URGENT", statusDurations: { IN_PROGRESS: 999 } }),
  ], [], now);
  assert.equal(metrics.tasks.length, 3);
  assert.equal(metrics.open.length, 1);
  assert.equal(metrics.done, 1);
  assert.equal(metrics.cancelled, 1);
  assert.deepEqual(metrics.priority[0], { label: "URGENT", value: 1 });
  assert.deepEqual(metrics.workload, [{ label: "Unassigned", value: 1 }]);
  assert.deepEqual(metrics.durations, [{ label: "IN_PROGRESS", value: 180 }]);
  assert.deepEqual(metrics.attention.overdue.map((item) => item.id), ["urgent"]);
  assert.deepEqual(metrics.attention.stale.map((item) => item.id), ["urgent"]);
});

test("attention respects blocking dependencies, invalid dates, and the stale threshold", () => {
  const metrics = projectMetrics("p1", [
    task({ id: "blocked", dependencies: [{ isBlocking: true }] as Task["dependencies"] }),
    task({ id: "reason", blockedReason: "Needs approval" }),
    task({ id: "resolved", dependencies: [{ isBlocking: false }] as Task["dependencies"] }),
    task({ id: "failed", status: "FAILED", dueDate: "invalid" }),
    task({ id: "recent", status: "IN_PROGRESS", updatedAt: "2026-09-15T08:00:01Z", dueDate: "2026-09-16" }),
  ], [], now);
  assert.deepEqual(metrics.attention.blocked.map((item) => item.id), ["blocked", "reason"]);
  assert.deepEqual(metrics.attention.failed.map((item) => item.id), ["failed"]);
  assert.equal(metrics.attention.overdue.length, 0);
  assert.equal(metrics.attention.stale.length, 0);
});

test("phase counts derive from scoped tasks even when summary counts are absent", () => {
  const phases = [{ id: "phase", projectId: "p1", number: 1 }, { id: "foreign", projectId: "p2" }] as Phase[];
  const metrics = projectMetrics("p1", [task({ phaseId: "phase" }), task({ phaseId: "phase", status: "DONE" }), task({ phaseId: "phase", status: "CANCELLED" })], phases, now);
  assert.equal(metrics.phases.length, 1);
  assert.equal(metrics.phases[0].total, 3);
  assert.equal(metrics.phases[0].open, 1);
  assert.equal(metrics.phases[0].done, 1);
  assert.equal(metrics.phases[0].cancelled, 1);
  assert.equal(projectMetrics("p1", [], [], now).workflow.length, 0);
});

test("project layouts persist independently of home and other projects, including empty layouts", () => {
  const store = new Map<string, string>([["taskforge_dashboard", "home-layout"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => store.get(key), setItem: (key: string, value: string) => store.set(key, value) } });
  const layout = defaultProjectLayout();
  layout.widgets = [{ ...layout.widgets[0], x: 3, y: 8, w: 9, h: 5 }];
  saveProjectLayout("p1", layout);
  saveProjectLayout("p2", { version: 2, widgets: [] });
  assert.deepEqual(loadProjectLayout("p1"), layout);
  assert.deepEqual(loadProjectLayout("p2"), { version: 2, widgets: [] });
  assert.equal(store.get("taskforge_dashboard"), "home-layout");
  saveProjectLayout("p1", defaultProjectLayout());
  assert.deepEqual(loadProjectLayout("p1"), defaultProjectLayout());
  assert.deepEqual(loadProjectLayout("p2").widgets, []);
});

test("corrupt storage, invalid geometry, duplicates, and unknown modules recover safely", () => {
  assert.deepEqual(normalizeProjectLayout({ version: 99, widgets: [] }), defaultProjectLayout());
  const valid = defaultProjectLayout().widgets[0];
  assert.deepEqual(normalizeProjectLayout({ version: 2, widgets: [valid, valid, { ...valid, id: "bad", x: 11, w: 6 }, { ...valid, id: "unknown", type: "toString" }] }).widgets, [valid]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
  assert.deepEqual(loadProjectLayout("p1"), defaultProjectLayout());
  assert.doesNotThrow(() => saveProjectLayout("p1", defaultProjectLayout()));
});
