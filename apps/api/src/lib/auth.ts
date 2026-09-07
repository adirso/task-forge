import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db/database.js";

type AuthRow = {
  id: string;
  name: string;
  email: string | null;
  kind: "HUMAN" | "AGENT";
  role: "ADMIN" | "MEMBER";
  tokenScopes: string[] | null;
  runCredential: { runId: string; taskId: string; projectId: string } | null;
};

export function createJwt(user: { id: string; kind: "HUMAN" | "AGENT"; role: "ADMIN" | "MEMBER" }) {
  return jwt.sign({ sub: user.id, kind: user.kind, role: user.role }, config.jwtSecret, { expiresIn: "8h" });
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createApiToken() {
  const prefix = crypto.randomBytes(5).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { token: `tf_${prefix}_${secret}`, prefix };
}

export function createRunCredential() {
  const prefix = crypto.randomBytes(5).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { token: `tfr_${prefix}_${secret}`, prefix };
}

async function runCredentialMayAccess(request: FastifyRequest, credential: NonNullable<AuthRow["runCredential"]>) {
  const pathname = new URL(request.url, "http://taskforge.local").pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();

  if (pathname === "/api/context" && method === "GET") {
    const query = request.query as { project?: string; task?: string };
    const row = await db.prepare("SELECT t.id, t.number, p.id AS project_id, p.`key` AS project_key FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.id = ?").get(credential.taskId, credential.projectId) as { id: string; number: number; project_id: string; project_key: string } | undefined;
    if (!row) return false;
    const projectMatches = query.project === row.project_id || query.project?.toUpperCase() === row.project_key.toUpperCase();
    const taskMatches = query.task === row.id || query.task?.toUpperCase() === `${row.project_key}-${row.number}`.toUpperCase();
    return Boolean(projectMatches && taskMatches);
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(\/.*)?$/);
  if (taskMatch) {
    if (decodeURIComponent(taskMatch[1]!) !== credential.taskId) return false;
    const suffix = taskMatch[2] ?? "";
    if (method === "GET") return ["", "/updates", "/agent-logs", "/findings", "/attachments", "/runs"].includes(suffix);
    if (method === "PATCH") return suffix === "";
    if (method === "POST") return ["/updates", "/agent-logs", "/findings"].includes(suffix);
    return false;
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)(\/.*)?$/);
  if (runMatch) {
    if (decodeURIComponent(runMatch[1]!) !== credential.runId) return false;
    const suffix = runMatch[2] ?? "";
    return (method === "GET" && suffix === "/handoff")
      || (method === "PUT" && suffix === "/handoff")
      || (method === "POST" && suffix === "/handoff/validate");
  }

  const findingMatch = pathname.match(/^\/api\/findings\/([^/]+)\/disposition$/);
  if (findingMatch && method === "POST") {
    const finding = await db.prepare("SELECT task_id FROM task_findings WHERE id = ?").get(decodeURIComponent(findingMatch[1]!)) as { task_id: string } | undefined;
    return finding?.task_id === credential.taskId;
  }

  const attachmentMatch = pathname.match(/^\/api\/attachments\/([^/]+)\/download$/);
  if (attachmentMatch && method === "GET") {
    const attachment = await db.prepare("SELECT task_id FROM task_attachments WHERE id = ?").get(decodeURIComponent(attachmentMatch[1]!)) as { task_id: string } | undefined;
    return attachment?.task_id === credential.taskId;
  }

  return false;
}

export function installAuth(app: FastifyInstance) {
  app.decorateRequest("authUser", undefined as never);
  app.decorate("authenticate", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const token = header.slice(7);
    let user: AuthRow | undefined;

    if (token.startsWith("tfr_")) {
      const now = new Date().toISOString();
      const row = await db.prepare(`
        SELECT u.id, u.name, u.email, u.kind, u.role, c.run_id, c.task_id, c.project_id,
          c.permissions AS token_permissions
        FROM agent_run_credentials c
        JOIN users u ON u.id = c.user_id
        JOIN agent_runs r ON r.id = c.run_id
        WHERE c.token_hash = ? AND c.revoked_at IS NULL AND c.expires_at > ?
          AND r.status = 'RUNNING' AND r.lease_owner = c.user_id
          AND r.attempt_count = c.run_attempt AND r.lease_expires_at > ?
      `).get(hashToken(token), now, now) as (Omit<AuthRow, "tokenScopes" | "runCredential"> & { run_id: string; task_id: string; project_id: string; token_permissions: string }) | undefined;
      if (row) {
        let tokenScopes: string[] = [];
        try { tokenScopes = JSON.parse(row.token_permissions); } catch { tokenScopes = []; }
        user = { id: row.id, name: row.name, email: row.email, kind: row.kind, role: row.role, tokenScopes, runCredential: { runId: row.run_id, taskId: row.task_id, projectId: row.project_id } };
        await db.prepare("UPDATE agent_run_credentials SET last_used_at = ?, updated_at = ? WHERE run_id = ?").run(now, now, row.run_id);
      }
    } else if (token.startsWith("tf_")) {
      const row = await db.prepare(`
        SELECT u.id, u.name, u.email, u.kind, u.role, t.id AS token_id, t.permissions AS token_permissions
        FROM api_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ? AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > ?)
      `).get(hashToken(token), new Date().toISOString()) as (AuthRow & { token_id: string; token_permissions: string | null }) | undefined;
      if (row) {
        let tokenScopes: string[] | null = null;
        if (row.token_permissions) {
          try { tokenScopes = JSON.parse(row.token_permissions); } catch { tokenScopes = null; }
        }
        user = { id: row.id, name: row.name, email: row.email, kind: row.kind, role: row.role, tokenScopes, runCredential: null };
        await db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.token_id);
      }
    } else {
      try {
        const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
        const row = await db.prepare("SELECT id, name, email, kind, role FROM users WHERE id = ?").get(payload.sub) as Omit<AuthRow, "tokenScopes"> | undefined;
        if (row) user = { ...row, tokenScopes: null, runCredential: null };
      } catch {
        user = undefined;
      }
    }

    if (!user) return reply.code(401).send({ error: "Invalid or expired credentials" });
    if (user.runCredential && !(await runCredentialMayAccess(request, user.runCredential))) {
      return reply.code(403).send({ error: "Run-scoped credential is limited to its assigned task and run" });
    }
    request.authUser = user;
  });
}
