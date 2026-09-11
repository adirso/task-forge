import assert from "node:assert/strict";
import test from "node:test";
import type { AgentArtifact } from "@taskforge/contracts";
import { artifactProvenance, artifactTypeLabel } from "../src/lib/agentArtifacts.js";

test("agent artifact provenance is concise and deterministic", () => {
  const artifact = { type: "TEST_RESULT", headSha: "a".repeat(40), contentHash: "b".repeat(64), size: 42 } as AgentArtifact;
  assert.equal(artifactTypeLabel(artifact.type), "Test result");
  assert.equal(artifactProvenance(artifact), "aaaaaaaaaaaa · sha256:bbbbbbbbbbbb · 42 bytes");
});
