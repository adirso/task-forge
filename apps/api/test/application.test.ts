import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/application/index.js";

test("application errors expose stable transport-independent codes", () => {
  assert.equal(new ConflictError("duplicate key").code, "CONFLICT");
  assert.equal(new ForbiddenError().code, "FORBIDDEN");
  assert.equal(new NotFoundError("Task").code, "NOT_FOUND");
  assert.equal(new ValidationError("invalid input").code, "VALIDATION");
});
