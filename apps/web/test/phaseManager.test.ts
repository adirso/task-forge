import assert from "node:assert/strict";
import test from "node:test";
import { canMergePhaseToMain } from "../src/lib/phaseMerge.js";

test("phase merge action is guarded by merge target and completion", () => {
  assert.equal(canMergePhaseToMain("main", 0), false);
  assert.equal(canMergePhaseToMain("phase", 2), false);
  assert.equal(canMergePhaseToMain("phase", 0), true);
});
