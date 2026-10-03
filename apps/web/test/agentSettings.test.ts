import assert from "node:assert/strict";
import test from "node:test";

/** Canonical Agents settings tabs — keep in sync with pages/SettingsPage agent detail. */
export const AGENT_SETTINGS_TABS = [
  { id: "identity", title: "Identity", includes: ["avatar", "picture"] },
  { id: "access", title: "Access", includes: ["webhook", "tokens"] },
  { id: "deliveries", title: "Deliveries", includes: ["delivery-history", "retry"] },
  { id: "routing", title: "Routing", includes: ["capabilities"] },
  { id: "danger", title: "Danger zone", includes: ["delete"] },
] as const;

test("agents settings keep a stable tab order for hierarchy", () => {
  assert.deepEqual(AGENT_SETTINGS_TABS.map((tab) => tab.title), [
    "Identity",
    "Access",
    "Deliveries",
    "Routing",
    "Danger zone",
  ]);
});

test("access tab covers credentials without delivery history crowding the panel", () => {
  const access = AGENT_SETTINGS_TABS.find((tab) => tab.id === "access");
  const deliveries = AGENT_SETTINGS_TABS.find((tab) => tab.id === "deliveries");
  assert.ok(access);
  assert.ok(deliveries);
  assert.ok(access.includes.includes("webhook"));
  assert.ok(access.includes.includes("tokens"));
  assert.equal(access.includes.includes("plaintext-secret"), false);
  assert.equal(access.includes.includes("delivery-history"), false);
  assert.ok(deliveries.includes.includes("delivery-history"));
  assert.ok(deliveries.includes.includes("retry"));
});
