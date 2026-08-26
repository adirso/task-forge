import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentHandoffEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

const sha = /^[0-9a-f]{7,64}$/i;
function redact(value: string) { return value.replace(/(authorization\s*:\s*bearer\s+|\b(?:token|password|secret|api[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED]").replace(/\btf_[A-Za-z0-9_-]+\b/g, "tf_[REDACTED]").replace(/\b(?:sk|whsec)_[A-Za-z0-9_-]+\b/g, "[REDACTED]"); }
export class AgentHandoffApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString()) {}
  async get(context: RequestContext, runId: string) { return this.unitOfWork.run(async r => { const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); return r.handoffs.findByRun(runId); }); }
  async save(context: RequestContext, runId: string, input: Omit<AgentHandoffEntity, "runId" | "taskId" | "createdAt" | "updatedAt">) {
    return this.unitOfWork.run(async r => { const run = await r.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(r, context, run.projectId); if (input.headSha && !sha.test(input.headSha)) throw new ValidationError("headSha must be a hexadecimal commit SHA"); if (input.status === "PUBLISHED" && (!input.branch || !input.headSha || !input.branchPublished || !input.pullRequestUrl || !input.pullRequestState)) throw new ValidationError("Published handoff requires branch, head SHA, published branch, and pull request metadata"); const existing = await r.handoffs.findByRun(runId); const now = this.now(); const entity: AgentHandoffEntity = { runId, taskId: run.taskId, ...input, lastError: input.lastError ? redact(input.lastError).slice(0, 1000) : null, createdAt: existing?.createdAt ?? now, updatedAt: now }; return r.handoffs.save(entity); });
  }
  async validate(context: RequestContext, runId: string) { const value = await this.get(context, runId); if (!value || value.status !== "PUBLISHED" || !value.branch || !value.headSha || !value.branchPublished || !value.pullRequestUrl || !value.pullRequestState) throw new ValidationError("Review handoff requires published branch, head SHA, and pull request evidence"); return value; }
  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await r.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
