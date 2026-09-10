import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAgentUsage } from "../src/lib/agentUsage.js";

test("dashboard agent usage is formatted deterministically", () => {
  assert.equal(formatAgentUsage({ inputTokens: 10_000, outputTokens: 2_345, totalTokens: 12_345, costMicros: 1_250_000, toolCalls: 9, runtimeMs: 10_600, retries: 1, forcedCycles: 0, runCount: 2, eventCount: 3 }), "12,345 tokens · $1.25 · 11s · 9 tools");
});
