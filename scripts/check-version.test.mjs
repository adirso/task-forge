import assert from "node:assert/strict";
import test from "node:test";
import { assertVersionIncreased, isVersionIncreased, parseVersion } from "./check-version.mjs";

test("accepts a greater patch, minor, or major version", () => {
  assert.equal(isVersionIncreased("1.0.1", "1.0.0"), true);
  assert.equal(isVersionIncreased("1.1.0", "1.0.9"), true);
  assert.equal(isVersionIncreased("2.0.0", "1.9.9"), true);
  assert.doesNotThrow(() => assertVersionIncreased("1.2.0", "1.1.9"));
});

test("rejects unchanged and lower versions", () => {
  assert.equal(isVersionIncreased("1.0.0", "1.0.0"), false);
  assert.equal(isVersionIncreased("1.0.0", "1.0.1"), false);
  assert.throws(() => assertVersionIncreased("1.0.0", "1.0.0"), /must be greater/);
});

test("rejects malformed semantic versions", () => {
  for (const value of ["", "1", "1.0", "v1.0.0", "1.0.0-beta", "01.2.3"]) assert.throws(() => parseVersion(value), /Invalid semantic version/);
});
