import assert from "node:assert/strict";
import test from "node:test";
import type { Project, User } from "@taskforge/contracts";
import { canForceCycle, FORCE_CYCLE_FAILURE_MESSAGE, forceCycleRequestId } from "../src/lib/cycleLimit.js";

const owner = { id: "owner-1", kind: "HUMAN", role: "MEMBER" } as User;
const member = { id: "member-1", kind: "HUMAN", role: "MEMBER" } as User;
const admin = { id: "admin-1", kind: "HUMAN", role: "ADMIN" } as User;
const agent = { id: "agent-1", kind: "AGENT", role: "MEMBER" } as User;
const project = { ownerId: owner.id } as Project;

test("force action is visible only to owners/admins for a current cycle-limit failure", () => {
  const failed = { count: 6, limit: 6, limitFailure: true };
  assert.equal(canForceCycle(owner, project, failed), true);
  assert.equal(canForceCycle(admin, project, failed), true);
  assert.equal(canForceCycle(member, project, failed), false);
  assert.equal(canForceCycle(agent, project, failed), false);
  assert.equal(canForceCycle(owner, project, { ...failed, limitFailure: false }), false);
});

test("browser retries reuse the same request id and expose only a safe failure", () => {
  assert.equal(forceCycleRequestId("task-1", 6), forceCycleRequestId("task-1", 6));
  assert.doesNotMatch(FORCE_CYCLE_FAILURE_MESSAGE, /token|secret|password|stack/i);
});
