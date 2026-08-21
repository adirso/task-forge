import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError, ConflictError, ForbiddenError, NotFoundError, ProjectApplicationService, ValidationError } from "../src/application/index.js";

test("application errors expose stable transport-independent codes", () => {
  assert.equal(new ConflictError("duplicate key").code, "CONFLICT");
  assert.equal(new ForbiddenError().code, "FORBIDDEN");
  assert.equal(new NotFoundError("Task").code, "NOT_FOUND");
  assert.equal(new ValidationError("invalid input").code, "VALIDATION");
  assert.equal(new ConfigurationError("missing setting").code, "INTERNAL");
});

test("project creation reports a missing default workflow as a configuration error", async () => {
  const service = new ProjectApplicationService({
    run: async (work) => work({
      projects: { findByKey: async () => null },
      workflows: { listSystemDefaultStatuses: async () => [] },
    } as never),
  });
  await assert.rejects(
    () => service.create(
      { actor: { userId: "owner-1", kind: "HUMAN", role: "ADMIN", tokenScopes: null } },
      { key: "CFG", name: "Configuration test", description: "", repoUrl: null, color: "#6554C0" },
    ),
    (error) => error instanceof ConfigurationError && error.code === "INTERNAL",
  );
});
