import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";

/** Records only routing metadata; credentials and request bodies never enter the audit record. */
export async function recordSecurityAudit(input: { action: string; outcome: "success" | "failure" | "throttled"; ip: string; account?: string | null; userId?: string | null }) {
  await db.prepare("INSERT INTO security_audit_events (id, action, outcome, ip_address, account, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), input.action, input.outcome, input.ip, input.account ?? null, input.userId ?? null, new Date().toISOString());
}
