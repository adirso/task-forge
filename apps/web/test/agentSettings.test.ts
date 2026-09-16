import assert from "node:assert/strict";
import test from "node:test";

/** Canonical Agents settings panels — keep in sync with SettingsPage agent detail. */
export const AGENT_SETTINGS_PANELS = [
  { id: "identity", title: "Identity", includes: ["avatar", "picture"] },
  { id: "access", title: "Access", includes: ["webhook", "tokens"] },
  { id: "routing", title: "Routing", includes: ["capabilities"] },
  { id: "danger", title: "Danger zone", includes: ["delete"] },
] as const;

test("agents settings keep a stable panel order for hierarchy", () => {
  assert.deepEqual(AGENT_SETTINGS_PANELS.map((panel) => panel.title), [
    "Identity",
    "Access",
    "Routing",
    "Danger zone",
  ]);
});

test("access panel covers credentials without exposing permanent secrets", () => {
  const access = AGENT_SETTINGS_PANELS.find((panel) => panel.id === "access");
  assert.ok(access);
  assert.ok(access.includes.includes("webhook"));
  assert.ok(access.includes.includes("tokens"));
  assert.equal(access.includes.includes("plaintext-secret"), false);
});
