import assert from "node:assert/strict";
import test from "node:test";
import { decideTag, tagForVersion } from "./release-tag.mjs";

test("derives deterministic annotated tag names from valid versions", () => {
  assert.equal(tagForVersion("1.2.3"), "v1.2.3");
  assert.deepEqual(decideTag("1.2.3", "abc"), { tag: "v1.2.3", action: "create" });
  assert.deepEqual(decideTag("1.2.3", "abc", "abc"), { tag: "v1.2.3", action: "already-present" });
});

test("rejects conflicting retries and malformed release versions", () => {
  assert.throws(() => decideTag("1.2.3", "new", "old"), /different commit/);
  for (const value of ["", "v1.2.3", "1.2", "1.2.3-beta"]) assert.throws(() => tagForVersion(value), /Invalid semantic version/);
});
