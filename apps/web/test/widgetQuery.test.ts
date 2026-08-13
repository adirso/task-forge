import assert from "node:assert/strict";
import test from "node:test";
import { failWidgetQuery, resolveWidgetQuery, startWidgetQuery } from "../src/lib/widgetQuery.js";

test("refresh starts a load by clearing data and showing the skeleton state", () => {
  assert.deepEqual(startWidgetQuery(), { data: null, error: "", loading: true });
});

test("a successful load stores data and stops loading", () => {
  assert.deepEqual(resolveWidgetQuery({ projects: [] }), {
    data: { projects: [] },
    error: "",
    loading: false,
  });
});

test("a failed load keeps no data and exposes a retryable error message", () => {
  assert.deepEqual(failWidgetQuery(new Error("Network down")), {
    data: null,
    error: "Network down",
    loading: false,
  });
});

test("unknown failures still produce a retryable error", () => {
  assert.equal(failWidgetQuery("nope").error, "Failed to load");
  assert.equal(failWidgetQuery("nope").loading, false);
  assert.equal(failWidgetQuery("nope").data, null);
});
