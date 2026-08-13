import assert from "node:assert/strict";
import test from "node:test";
import { activityHref, projectBoardHref, taskHref } from "../src/lib/dashboardNav.js";

const origin = "http://127.0.0.1:5173/?view=board&project=OLD&task=OLD-1";

test("opens a project board from Home without leftover query params", () => {
  assert.equal(projectBoardHref(origin, "TAS"), "http://127.0.0.1:5173/?project=TAS");
});

test("opens a task as KEY-N from Home", () => {
  assert.equal(taskHref(origin, "TAS", 34), "http://127.0.0.1:5173/?project=TAS&task=TAS-34");
});

test("activity with a task navigates to KEY-N", () => {
  assert.equal(
    activityHref(origin, { taskId: "task-1", projectKey: "TAS", taskNumber: 34 }),
    "http://127.0.0.1:5173/?project=TAS&task=TAS-34",
  );
});

test("activity without a task is not clickable", () => {
  assert.equal(activityHref(origin, { taskId: null, projectKey: "TAS", taskNumber: null }), null);
});

test("activity with a missing task number is not clickable", () => {
  assert.equal(activityHref(origin, { taskId: "task-1", projectKey: "TAS", taskNumber: null }), null);
});
