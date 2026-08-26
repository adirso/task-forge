import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/database.js";
import { createUnitOfWork } from "../infrastructure/database.js";
import { AgentHandoffApplicationService } from "../application/handoff-service.js";
const service = new AgentHandoffApplicationService(createUnitOfWork(db));
const context = (request: any) => ({ actor: { userId: request.authUser.id, kind: request.authUser.kind, role: request.authUser.role, name: request.authUser.name, tokenScopes: request.authUser.tokenScopes } });
const schema = z.object({ branch: z.string().trim().max(2048).nullable(), headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).nullable(), branchPublished: z.boolean(), pullRequestUrl: z.string().url().nullable(), pullRequestTitle: z.string().trim().max(255).nullable(), pullRequestState: z.enum(["DRAFT", "OPEN", "MERGED", "CLOSED"]).nullable(), status: z.enum(["PENDING", "PUBLISHED", "FAILED"]), lastError: z.string().trim().max(1000).nullable().optional() });
export async function handoffRoutes(app: FastifyInstance) { app.addHook("preHandler", app.authenticate); app.get<{ Params: { id: string } }>("/runs/:id/handoff", async request => ({ handoff: await service.get(context(request), request.params.id) })); app.put<{ Params: { id: string } }>("/runs/:id/handoff", async request => { const input = schema.parse(request.body); return { handoff: await service.save(context(request), request.params.id, { ...input, lastError: input.lastError ?? null }) }; }); app.post<{ Params: { id: string } }>("/runs/:id/handoff/validate", async request => ({ handoff: await service.validate(context(request), request.params.id) })); }
