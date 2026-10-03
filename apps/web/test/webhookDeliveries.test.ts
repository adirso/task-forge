import assert from "node:assert/strict";
import test from "node:test";
import type { WebhookDelivery } from "@taskforge/contracts";
import { summarizeWebhookDeliveries } from "../src/lib/webhookDeliveries.js";

function delivery(status: WebhookDelivery["status"], id = status): WebhookDelivery {
  return {
    id,
    agentId: "agent-1",
    agentName: "Builder",
    taskId: null,
    taskNumber: null,
    projectKey: null,
    eventType: "task.status_changed",
    status,
    attemptCount: 1,
    nextAttemptAt: "2026-01-01T00:00:00.000Z",
    lastAttemptAt: null,
    deliveredAt: null,
    failedAt: null,
    lastError: null,
    httpStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("summarizeWebhookDeliveries prefers failed counts in the summary", () => {
  assert.equal(
    summarizeWebhookDeliveries([
      delivery("FAILED", "1"),
      delivery("FAILED", "2"),
      delivery("DELIVERED", "3"),
    ]),
    "3 recent · 2 failed",
  );
});

test("summarizeWebhookDeliveries falls back to pending then delivered", () => {
  assert.equal(summarizeWebhookDeliveries([delivery("PENDING"), delivery("RETRYING")]), "2 recent · 2 pending");
  assert.equal(summarizeWebhookDeliveries([delivery("DELIVERED")]), "1 recent · 1 delivered");
});
