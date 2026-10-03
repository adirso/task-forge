import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentDetailTab, parseSettingsTab, readSettingsLocation, writeSettingsLocation } from "../src/lib/settingsNav.js";

test("parseSettingsTab restores known tabs and rejects admin-only tabs for members", () => {
  assert.equal(parseSettingsTab("agents", true), "agents");
  assert.equal(parseSettingsTab("backup", true), "backup");
  assert.equal(parseSettingsTab("backup", false), "account");
  assert.equal(parseSettingsTab("nope", true), "account");
  assert.equal(parseSettingsTab("", true), "account");
});

test("parseAgentDetailTab restores known agent tabs", () => {
  assert.equal(parseAgentDetailTab("deliveries"), "deliveries");
  assert.equal(parseAgentDetailTab("danger"), "danger");
  assert.equal(parseAgentDetailTab("nope"), "identity");
});

test("readSettingsLocation hydrates settings and agent detail from the query string", () => {
  assert.deepEqual(readSettingsLocation("?settings=agents&agent=agent-1&agentTab=deliveries", true), {
    tab: "agents",
    agentId: "agent-1",
    agentTab: "deliveries",
  });
});

test("writeSettingsLocation keeps the active settings tab and agent detail params", () => {
  assert.equal(
    writeSettingsLocation({
      href: "http://127.0.0.1:5173/?view=board&project=TAS&task=TAS-1",
      tab: "agents",
      agentId: "agent-1",
      agentTab: "deliveries",
    }),
    "/?settings=agents&agent=agent-1&agentTab=deliveries",
  );
  assert.equal(
    writeSettingsLocation({
      href: "http://127.0.0.1:5173/?settings=agents&agent=agent-1&agentTab=deliveries",
      tab: "account",
    }),
    "/?settings=account",
  );
});
