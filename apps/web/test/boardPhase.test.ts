import assert from "node:assert/strict";
import test from "node:test";
import type { Phase } from "@taskforge/contracts";
import { boardPhaseQueryValue, resolveBoardPhase } from "../src/lib/boardPhase.js";

const phases: Phase[] = [
  { id: "phase-1", projectId: "project-id", number: 1, goal: "Ship the foundation", isActive: true, createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" },
  { id: "phase-2", projectId: "project-id", number: 2, goal: "Expand workflows", isActive: false, createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" },
];

test("defaults the board to the active phase", () => {
  assert.equal(resolveBoardPhase(phases)?.id, "phase-1");
  assert.equal(resolveBoardPhase(phases, "unknown")?.id, "phase-1");
});

test("restores a requested phase by its shareable number or id", () => {
  assert.equal(resolveBoardPhase(phases, "2")?.id, "phase-2");
  assert.equal(resolveBoardPhase(phases, "phase-2")?.id, "phase-2");
});

test("only adds a phase query parameter for a non-active selection", () => {
  assert.equal(boardPhaseQueryValue(phases[0], phases[0]), null);
  assert.equal(boardPhaseQueryValue(phases[1], phases[0]), "2");
  assert.equal(boardPhaseQueryValue(null, phases[0]), null);
});
