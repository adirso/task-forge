import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { DEFAULT_AGENT_WORKFLOW, TASK_STATUSES, agentWorkflowSchema, phaseBranchName } from "@taskforge/contracts";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { ProjectContext, RequestContext } from "./context.js";
import type { PhaseEntity, ProjectEntity, UserEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";
import type { PhaseService, ProjectCreateInput, ProjectService, UserService } from "./services.js";

const STUCK_THRESHOLD_MS = 4 * 60 * 60 * 1000;

async function projectAccess(repositories: RepositorySet, context: RequestContext, projectId: string) {
  const project = await repositories.projects.findById(projectId);
  if (!project) throw new NotFoundError("Project");
  if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
  return project;
}

export class ProjectApplicationService implements ProjectService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID) {}
  async list(context: RequestContext) { return this.unitOfWork.run((repositories) => repositories.projects.listAccessible(context.actor.userId, context.actor.role === "ADMIN")); }
  async get(context: ProjectContext) { return this.unitOfWork.run(async (repositories) => { const project = await projectAccess(repositories, context, context.projectId); const members = await repositories.memberships.list(context.projectId); return { ...project, members: members.map((member) => ({ ...member, projectRole: member.id === project.ownerId ? "OWNER" as const : "MEMBER" as const })) }; }); }
  async create(context: RequestContext, input: ProjectCreateInput) { return this.unitOfWork.run(async (repositories) => { if (await repositories.projects.findByKey(input.key)) throw new ConflictError(`Project key ${input.key} is already in use`); const now = this.now(); const project: ProjectEntity = { ...input, sortOrder: await repositories.projects.allocateSortOrder(), availableStatuses: [...TASK_STATUSES], defaultStatus: "TODO", agentWorkflow: { ...DEFAULT_AGENT_WORKFLOW }, hiddenEmptyStatuses: [...TASK_STATUSES], mergeTarget: "main", id: this.newId(), ownerId: context.actor.userId, createdAt: now, updatedAt: now }; await repositories.projects.create(project); await repositories.memberships.add(project.id, context.actor.userId, "OWNER"); await repositories.phases.create({ id: this.newId(), projectId: project.id, number: 1, goal: "Plan and deliver the first project milestone.", isActive: true, createdAt: now, updatedAt: now }); return project; }); }
  async update(context: ProjectContext, input: Partial<Pick<ProjectEntity, "name" | "description" | "repoUrl" | "localRepoPath" | "color" | "availableStatuses" | "defaultStatus" | "agentWorkflow" | "hiddenEmptyStatuses" | "mergeTarget">>) { return this.unitOfWork.run(async (repositories) => {
    const project = await projectAccess(repositories, context, context.projectId);
    let changes = input;
    const changesStatusConfiguration = input.availableStatuses !== undefined || input.defaultStatus !== undefined || input.agentWorkflow !== undefined || input.hiddenEmptyStatuses !== undefined || input.mergeTarget !== undefined;
    if (changesStatusConfiguration && context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can manage task statuses");
    const availableStatuses = input.availableStatuses ?? project.availableStatuses;
    const configuredHidden = input.hiddenEmptyStatuses ?? project.hiddenEmptyStatuses ?? project.availableStatuses;
    const hiddenEmptyStatuses = input.availableStatuses && input.hiddenEmptyStatuses === undefined ? configuredHidden.filter((status) => availableStatuses.includes(status)) : configuredHidden;
    const unavailableHidden = hiddenEmptyStatuses.filter((status) => !availableStatuses.includes(status));
    if (unavailableHidden.length) throw new ValidationError(`Hide-empty statuses must be enabled in this project: ${unavailableHidden.join(", ")}`);
    if (input.availableStatuses && input.hiddenEmptyStatuses === undefined) changes = { ...changes, hiddenEmptyStatuses };
    const defaultStatus = input.defaultStatus ?? project.defaultStatus;
    if (!availableStatuses.length) throw new ValidationError("At least one task status must be available");
    if (!availableStatuses.includes(defaultStatus)) throw new ValidationError("The default status must be available in this project");
    const workflow = input.agentWorkflow !== undefined ? input.agentWorkflow : project.agentWorkflow;
    if (workflow !== undefined && workflow !== null) {
      const parsed = agentWorkflowSchema.safeParse(workflow);
      if (!parsed.success) throw new ValidationError("Agent workflow must define all eight workflow roles");
      const unavailable = Object.entries(parsed.data).filter(([, status]) => !availableStatuses.includes(status)).map(([role, status]) => `${role}=${status}`);
      if (unavailable.length) {
        if (input.agentWorkflow !== undefined) throw new ValidationError(`Enable these statuses before assigning workflow roles: ${unavailable.join(", ")}`);
        changes = { ...input, agentWorkflow: null };
      }
    }
    if (input.availableStatuses) {
      const unavailableInUse = (await repositories.tasks.listUsedStatuses(context.projectId)).filter((status) => !availableStatuses.includes(status));
      if (unavailableInUse.length) throw new ValidationError(`Move tasks out of ${unavailableInUse.join(", ")} before disabling those statuses`);
      const automationStatuses = (await repositories.automations.listForProject(context.projectId)).flatMap((automation) => [
        ...automation.conditions.filter((condition) => condition.field === "status").map((condition) => condition.value),
        ...automation.actions.filter((action) => action.field === "status").map((action) => action.value),
      ]).filter((status): status is string => Boolean(status));
      const unavailableInAutomation = [...new Set(automationStatuses.filter((status) => !availableStatuses.includes(status as ProjectEntity["defaultStatus"])))];
      if (unavailableInAutomation.length) throw new ValidationError(`Update automations using ${unavailableInAutomation.join(", ")} before disabling those statuses`);
    }
    return repositories.projects.update(context.projectId, changes);
  }); }
  async enableAgentWorkflow(context: ProjectContext) {
    return this.unitOfWork.run(async (repositories) => {
      const project = await projectAccess(repositories, context, context.projectId);
      if (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can enable the agent workflow");
      return repositories.projects.update(project.id, { availableStatuses: [...new Set([...project.availableStatuses, ...Object.values(DEFAULT_AGENT_WORKFLOW)])], agentWorkflow: { ...DEFAULT_AGENT_WORKFLOW } });
    });
  }
  async delete(context: ProjectContext) { return this.unitOfWork.run(async (repositories) => { const project = await projectAccess(repositories, context, context.projectId); if (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can delete this project"); await repositories.projects.delete(context.projectId); }); }
  async reorder(context: RequestContext, projectIds: string[]) { return this.unitOfWork.run(async (repositories) => { const accessible = await repositories.projects.listAccessible(context.actor.userId, context.actor.role === "ADMIN"); const allowed = new Set(accessible.map((project) => project.id)); if (projectIds.length !== accessible.length || projectIds.some((id) => !allowed.has(id))) throw new ValidationError("Project order must include every accessible project exactly once"); if (new Set(projectIds).size !== projectIds.length) throw new ValidationError("Project order contains duplicates"); await repositories.projects.reorder(projectIds); }); }
  async addMember(context: ProjectContext, userId: string, role: "OWNER" | "MEMBER") { return this.unitOfWork.run(async (repositories) => { const project = await projectAccess(repositories, context, context.projectId); if (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can manage members"); const user = await repositories.users.findById(userId); if (!user) throw new NotFoundError("User"); if (role === "OWNER" && userId !== project.ownerId) throw new ValidationError("A project can only have its original owner"); await repositories.memberships.add(context.projectId, userId, userId === project.ownerId ? "OWNER" : role); }); }
  async removeMember(context: ProjectContext, userId: string) { return this.unitOfWork.run(async (repositories) => { const project = await projectAccess(repositories, context, context.projectId); if (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can manage members"); if (userId === project.ownerId) throw new ValidationError("The project owner cannot be removed"); if (!(await repositories.memberships.isMember(context.projectId, userId))) throw new NotFoundError("Project member"); await repositories.tasks.unassignForProjectMember(context.projectId, userId); await repositories.memberships.remove(context.projectId, userId); }); }
}

export class PhaseApplicationService implements PhaseService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID) {}
  async list(context: ProjectContext) { await this.unitOfWork.run((repositories) => projectAccess(repositories, context, context.projectId)); return this.unitOfWork.run((repositories) => repositories.phases.list(context.projectId)); }
  async create(context: ProjectContext, input: { number: number; goal: string; isActive: boolean }) { return this.unitOfWork.run(async (repositories) => { await projectAccess(repositories, context, context.projectId); const phases = await repositories.phases.list(context.projectId); if (phases.some((phase) => phase.number === input.number)) throw new ConflictError(`Phase number ${input.number} is already in use`); if (input.isActive) await repositories.phases.deactivateOthers(context.projectId); const now = this.now(); const phase: PhaseEntity = { ...input, id: this.newId(), projectId: context.projectId, createdAt: now, updatedAt: now }; return repositories.phases.create(phase); }); }
  async update(context: RequestContext, phaseId: string, input: Partial<Pick<PhaseEntity, "number" | "goal" | "isActive">>) { return this.unitOfWork.run(async (repositories) => { const existing = await repositories.phases.findById(phaseId); if (!existing) throw new NotFoundError("Phase"); await projectAccess(repositories, context, existing.projectId); const phases = await repositories.phases.list(existing.projectId); if (input.number !== undefined && phases.some((phase) => phase.id !== phaseId && phase.number === input.number)) throw new ConflictError(`Phase number ${input.number} is already in use`); if (existing.isActive && input.isActive === false) throw new ValidationError("A project must have an active phase"); if (input.isActive) await repositories.phases.deactivateOthers(existing.projectId, phaseId); return repositories.phases.update(phaseId, input); }); }
  async delete(context: RequestContext, phaseId: string, options: { taskAction?: "move" | "delete"; targetPhaseId?: string } = {}) {
    return this.unitOfWork.run(async (repositories) => {
      const existing = await repositories.phases.findById(phaseId);
      if (!existing) throw new NotFoundError("Phase");
      await projectAccess(repositories, context, existing.projectId);
      const taskCount = await repositories.tasks.countByPhase(phaseId);
      if (taskCount > 0) {
        if (!options.taskAction) throw new ValidationError("Choose whether to move or delete this phase's tasks");
        if (options.taskAction === "move") {
          if (!options.targetPhaseId) throw new ValidationError("Choose a phase to move tasks into");
          const target = await repositories.phases.findById(options.targetPhaseId);
          if (!target || target.projectId !== existing.projectId || target.id === phaseId) throw new ValidationError("Tasks can only be moved to another phase in this project");
          await repositories.tasks.reassignPhase(phaseId, target.id);
        } else {
          await repositories.tasks.deleteByPhase(phaseId);
        }
      }
      const phases = await repositories.phases.list(existing.projectId);
      const replacement = existing.isActive ? phases.filter((phase) => phase.id !== phaseId).sort((a, b) => b.number - a.number)[0] : undefined;
      if (replacement) {
        await repositories.phases.deactivateOthers(existing.projectId);
        await repositories.phases.update(replacement.id, { isActive: true });
      }
      await repositories.phases.delete(phaseId);
    });
  }
  async ensureBranch(context: ProjectContext, phaseId: string) { return this.unitOfWork.run(async (repositories) => { const phase = await repositories.phases.findById(phaseId); if (!phase || phase.projectId !== context.projectId) throw new NotFoundError("Phase"); const project = await projectAccess(repositories, context, context.projectId); if (project.mergeTarget !== "phase") throw new ValidationError("Phase branches are disabled for this project"); const branchName = phase.branchName ?? phaseBranchName(project.key, phase.number); if (!phase.branchName) await repositories.phases.update(phase.id, { branchName }); return { phaseId: phase.id, branchName }; }); }
  async mergeToMain(context: ProjectContext, phaseId: string) { return this.unitOfWork.run(async (repositories) => { const phase = await repositories.phases.findById(phaseId); if (!phase || phase.projectId !== context.projectId) throw new NotFoundError("Phase"); const project = await projectAccess(repositories, context, context.projectId); if (context.actor.role !== "ADMIN" && project.ownerId !== context.actor.userId) throw new ForbiddenError("Only the project owner or an administrator can merge a phase to main"); if (project.mergeTarget !== "phase") throw new ValidationError("Phase-to-main merge is only available in phase mode"); if (await repositories.tasks.hasIncompleteByPhase(phaseId)) throw new ValidationError("Every task in the phase must be DONE or CANCELLED before merging to main"); const branchName = phase.branchName ?? phaseBranchName(project.key, phase.number); if (!phase.branchName) await repositories.phases.update(phase.id, { branchName }); return { phaseId: phase.id, branchName, target: "main" as const }; }); }
}

export class UserApplicationService implements UserService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now: () => string = () => new Date().toISOString(), private readonly newId: () => string = randomUUID, private readonly tokenAdapter: { create: () => { token: string; prefix: string }; hash: (token: string) => string; encrypt: (token: string) => string; decrypt: (ciphertext: string) => string } = { create: () => { throw new Error("Token issuer is not configured"); }, hash: () => { throw new Error("Token issuer is not configured"); }, encrypt: () => { throw new Error("Token encryption is not configured"); }, decrypt: () => { throw new Error("Token encryption is not configured"); } }, private readonly webhookSecretAdapter: { create: () => string; encrypt: (secret: string) => string } = { create: () => { throw new Error("Webhook secret issuer is not configured"); }, encrypt: () => { throw new Error("Webhook secret issuer is not configured"); } }) {}
  async list(context: RequestContext) { if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); return this.unitOfWork.run((repositories) => repositories.users.list()); }
  async updateProfile(context: RequestContext, input: { name: string; email: string }) { if (context.actor.kind !== "HUMAN") throw new ValidationError("Agent profiles are managed by administrators"); return this.unitOfWork.run((repositories) => repositories.users.saveProfile(context.actor.userId, input)); }
  async updateAvatar(context: RequestContext, userId: string, avatarUrl: string | null) { if (context.actor.userId !== userId && context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); if (avatarUrl !== null) { const match = avatarUrl.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i); if (!match || Buffer.byteLength(match[2]!, "base64") > 2 * 1024 * 1024) throw new ValidationError("Profile pictures must be valid images smaller than 2 MB"); } return this.unitOfWork.run(async (repositories) => { if (!(await repositories.users.findById(userId))) throw new NotFoundError("User"); return repositories.users.updateAvatar(userId, avatarUrl); }); }
  async createAgent(context: RequestContext, input: { name: string; email?: string }) { if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); const id = this.newId(); return this.unitOfWork.run((repositories) => repositories.users.createAgent({ id, name: input.name, email: input.email ?? `${id.slice(0, 8)}@agents.taskforge.local`, createdAt: this.now() })); }
  async updateAgentWebhook(context: RequestContext, agentId: string, webhookUrl: string | null) { if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); return this.unitOfWork.run(async (repositories) => { const agent = await repositories.users.findById(agentId); if (!agent) throw new NotFoundError("Agent"); if (agent.kind !== "AGENT") throw new ValidationError("Only agent identities can have a webhook URL"); const configuration = await repositories.users.getWebhookConfiguration(agentId); if (webhookUrl && !configuration?.secretCiphertext) { const webhookSecret = this.webhookSecretAdapter.create(); const user = await repositories.users.updateWebhookConfiguration(agentId, { webhookUrl, secretCiphertext: this.webhookSecretAdapter.encrypt(webhookSecret), secretVersion: 1 }); return { user, webhookSecret }; } return { user: await repositories.users.updateWebhookConfiguration(agentId, { webhookUrl }) }; }); }
  async rotateAgentWebhookSecret(context: RequestContext, agentId: string) { if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); return this.unitOfWork.run(async (repositories) => { const agent = await repositories.users.findById(agentId); if (!agent) throw new NotFoundError("Agent"); if (agent.kind !== "AGENT") throw new ValidationError("Only agent identities can have a webhook signing secret"); const configuration = await repositories.users.getWebhookConfiguration(agentId); const webhookSecret = this.webhookSecretAdapter.create(); const user = await repositories.users.updateWebhookConfiguration(agentId, { secretCiphertext: this.webhookSecretAdapter.encrypt(webhookSecret), secretVersion: (configuration?.secretVersion ?? 0) + 1 }); return { user, webhookSecret }; }); }
  async deleteAgent(context: RequestContext, agentId: string) { if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); return this.unitOfWork.run(async (repositories) => { const agent = await repositories.users.findById(agentId); if (!agent) throw new NotFoundError("Agent"); if (agent.kind !== "AGENT") throw new ValidationError("Only agent identities can be deleted"); if (await repositories.users.hasAgentHistory(agentId)) throw new ConflictError("This agent has project or task history and cannot be deleted. Revoke its tokens and remove its project memberships instead."); await repositories.users.deleteAgent(agentId); }); }
  private canManage(context: RequestContext, userId: string) { if (context.actor.userId !== userId && context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required"); }
  async listTokens(context: RequestContext, userId: string) { this.canManage(context, userId); return this.unitOfWork.run(async (repositories) => { if (!(await repositories.users.findById(userId))) throw new NotFoundError("User"); return repositories.tokens.listForUser(userId); }); }
  async issueToken(context: RequestContext, userId: string, input: { name: string; expiresInDays: number | null; permissions?: string[] | null }) { this.canManage(context, userId); return this.unitOfWork.run(async (repositories) => { if (!(await repositories.users.findById(userId))) throw new NotFoundError("User"); const { token, prefix } = this.tokenAdapter.create(); const now = new Date(this.now()); const expiresAt = input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString(); await repositories.tokens.create({ id: this.newId(), userId, name: input.name, prefix, hash: this.tokenAdapter.hash(token), ciphertext: this.tokenAdapter.encrypt(token), permissions: input.permissions ?? null, expiresAt, createdAt: now.toISOString() }); return { token, prefix, expiresAt }; }); }
  async revealToken(context: RequestContext, userId: string, tokenId: string) { this.canManage(context, userId); return this.unitOfWork.run(async (repositories) => { const token = await repositories.tokens.findById(tokenId); if (!token || token.userId !== userId) throw new NotFoundError("Token"); if (token.revokedAt) throw new ValidationError("Revoked tokens cannot be revealed"); if (!token.ciphertext) throw new ValidationError("This token was issued before reveal support and cannot be recovered. Revoke it and issue a new one."); try { return { token: this.tokenAdapter.decrypt(token.ciphertext) }; } catch { throw new ValidationError("Could not decrypt this token. Check TOKEN_ENCRYPTION_KEY."); } }); }
  async revokeToken(context: RequestContext, tokenId: string) { return this.unitOfWork.run(async (repositories) => { const token = await repositories.tokens.findById(tokenId); if (!token) throw new NotFoundError("Token"); this.canManage(context, token.userId); await repositories.tokens.revoke(tokenId); }); }
  async agentOperations(context: RequestContext) {
    if (context.actor.role !== "ADMIN") throw new ForbiddenError("Administrator access required");
    return this.unitOfWork.run(async (repositories) => {
      const agents = (await repositories.users.list()).filter((user) => user.kind === "AGENT");
      const agentIds = agents.map((agent) => agent.id);
      const [tasks, activity] = await Promise.all([
        repositories.reporting.listAgentInProgressTasks(agentIds),
        repositories.reporting.listAgentLastActive(agentIds),
      ]);
      const tasksByAgent = new Map<string, typeof tasks>();
      for (const task of tasks) {
        if (!task.assigneeId) continue;
        tasksByAgent.set(task.assigneeId, [...(tasksByAgent.get(task.assigneeId) ?? []), task]);
      }
      const lastActiveByAgent = new Map(activity.map((entry) => [entry.agentId, entry.lastActiveAt]));
      const cutoff = new Date(new Date(this.now()).getTime() - STUCK_THRESHOLD_MS).toISOString();
      return agents.map((agent) => {
        const inProgressTasks = tasksByAgent.get(agent.id) ?? [];
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          kind: agent.kind,
          role: agent.role,
          avatarUrl: agent.avatarUrl,
          webhookUrl: agent.webhookUrl ?? null,
          createdAt: agent.createdAt,
          lastActiveAt: lastActiveByAgent.get(agent.id) ?? null,
          openTaskCount: inProgressTasks.length,
          stuckTaskCount: inProgressTasks.filter((task) => task.updatedAt < cutoff).length,
          inProgressTasks: inProgressTasks.map((task) => ({ id: task.id, title: task.title, number: task.number, projectId: task.projectId, projectName: task.projectName, projectKey: task.projectKey, updatedAt: task.updatedAt, isStuck: task.updatedAt < cutoff })),
        };
      });
    });
  }
}
