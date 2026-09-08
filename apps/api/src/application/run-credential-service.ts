import type { TokenScope } from "./context.js";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentRunCredentialEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

const RUN_CREDENTIAL_TTL_MS = 45 * 60_000;
const RUN_CREDENTIAL_SCOPES: TokenScope[] = [
  "task:read",
  "task:update:status",
  "task:update:notes",
  "task:update:branch",
];

type TokenAdapter = {
  create: () => { token: string; prefix: string };
  hash: (token: string) => string;
  encrypt: (token: string) => string;
  decrypt: (ciphertext: string) => string;
};

export class AgentRunCredentialApplicationService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly tokenAdapter: TokenAdapter,
    private readonly now = () => new Date().toISOString(),
  ) {}

  async issue(context: RequestContext, runId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await repositories.runs.findById(runId);
      if (!run) throw new NotFoundError("Agent run");
      await this.authorize(repositories, context, run.projectId);
      if (context.actor.kind !== "AGENT" || run.status !== "RUNNING" || run.controlState !== "ACTIVE" || run.leaseOwner !== context.actor.userId) {
        throw new ForbiddenError("Only the current agent run lease owner can issue a run credential");
      }

      const now = this.now();
      const existing = await repositories.tokens.findRunCredential(runId);
      if (existing && existing.userId === context.actor.userId && existing.runAttempt === run.attemptCount && !existing.revokedAt && existing.expiresAt > now) {
        return { token: this.decrypt(existing.ciphertext), expiresAt: existing.expiresAt };
      }

      const { token, prefix } = this.tokenAdapter.create();
      const timeoutAt = run.timeoutAt && run.timeoutAt > now ? Date.parse(run.timeoutAt) : Number.POSITIVE_INFINITY;
      const expiresAt = new Date(Math.min(Date.parse(now) + RUN_CREDENTIAL_TTL_MS, timeoutAt)).toISOString();
      const credential: AgentRunCredentialEntity = {
        runId,
        taskId: run.taskId,
        projectId: run.projectId,
        userId: context.actor.userId,
        runAttempt: run.attemptCount,
        prefix,
        hash: this.tokenAdapter.hash(token),
        ciphertext: this.tokenAdapter.encrypt(token),
        permissions: [...RUN_CREDENTIAL_SCOPES],
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await repositories.tokens.saveRunCredential(credential);
      await repositories.activity.record({ projectId: run.projectId, taskId: run.taskId, actorId: context.actor.userId, action: "agent_run.credential_issued", metadata: { runId, runAttempt: run.attemptCount, expiresAt } });
      return { token, expiresAt };
    });
  }

  async revoke(context: RequestContext, runId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await repositories.runs.findById(runId);
      if (!run) throw new NotFoundError("Agent run");
      const project = await this.authorize(repositories, context, run.projectId);
      const ownsRun = context.actor.kind === "AGENT" && (run.leaseOwner === context.actor.userId || run.requestedById === context.actor.userId);
      if (!ownsRun && context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) {
        throw new ForbiddenError("Only the run owner, project owner, or administrator can revoke a run credential");
      }
      const revokedAt = this.now();
      await repositories.tokens.revokeRunCredential(runId, revokedAt);
      await repositories.activity.record({ projectId: run.projectId, taskId: run.taskId, actorId: context.actor.userId, action: "agent_run.credential_revoked", metadata: { runId } });
    });
  }

  private decrypt(ciphertext: string) {
    try { return this.tokenAdapter.decrypt(ciphertext); }
    catch { throw new ValidationError("Run credential could not be recovered; revoke it and retry the run"); }
  }

  private async authorize(repositories: RepositorySet, context: RequestContext, projectId: string) {
    const project = await repositories.projects.findById(projectId);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
    return project;
  }
}
