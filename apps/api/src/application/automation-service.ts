import { randomUUID } from "node:crypto";
import type { AutomationCopy, AutomationCopyResult, AutomationCreate, AutomationUpdate } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { ProjectContext, RequestContext } from "./context.js";
import type { AutomationEntity, TaskEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export class AutomationApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString()) {}
  async list(context: ProjectContext) { return this.unitOfWork.run(async (r) => { await this.authorize(r, context, context.projectId); return r.automations.listForProject(context.projectId); }); }
  async create(context: ProjectContext, input: AutomationCreate) { return this.unitOfWork.run(async (r) => { const project = await this.authorize(r, context, context.projectId); this.validate(input, project.availableStatuses); const now = this.now(); return r.automations.create({ ...input, id: randomUUID(), projectId: context.projectId, enabled: input.enabled ?? true, trigger: input.trigger ?? "TASK_UPDATED", actorType: input.actorType ?? "ANY", actorId: input.actorId ?? null, service: input.service ?? null, conditions: input.conditions ?? [], createdAt: now, updatedAt: now } as AutomationEntity); }); }
  async update(context: RequestContext, id: string, input: AutomationUpdate) { return this.unitOfWork.run(async (r) => { const current = await r.automations.findById(id); if (!current) throw new NotFoundError("Automation"); const project = await this.authorize(r, context, current.projectId); this.validate({ ...current, ...input }, project.availableStatuses); return r.automations.update(id, input); }); }
  async delete(context: RequestContext, id: string) { return this.unitOfWork.run(async (r) => { const current = await r.automations.findById(id); if (!current) throw new NotFoundError("Automation"); await this.authorize(r, context, current.projectId); await r.automations.delete(id); }); }
  async copy(context: ProjectContext, input: AutomationCopy): Promise<AutomationCopyResult> {
    return this.unitOfWork.run(async (r) => {
      await this.authorize(r, context, context.projectId);
      const destination = await this.authorize(r, context, input.destinationProjectId);
      if (destination.id === context.projectId) throw new ValidationError("Choose a different destination project");
      const rules = await r.automations.listForProject(context.projectId);
      // Resolve the entire selection within the authorized source before writing anything.
      const selected = input.automationIds.map((id) => {
        const rule = rules.find((item) => item.id === id);
        if (!rule) throw new NotFoundError("Selected automation in source project");
        return rule;
      });
      const result: AutomationCopyResult = { copied: [], failures: [] };
      for (const rule of selected) {
        try {
          this.validate(rule, destination.availableStatuses);
          await this.validateCopyReferences(r, rule, destination.id);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          result.failures.push({ sourceId: rule.id, name: rule.name, reason: error.message });
          continue;
        }
        const now = this.now();
        const automation = await r.automations.create({ ...structuredClone(rule), id: randomUUID(), projectId: destination.id, createdAt: now, updatedAt: now });
        result.copied.push({ sourceId: rule.id, automation });
      }
      return result;
    });
  }
  private async validateCopyReferences(r: RepositorySet, rule: AutomationEntity, projectId: string) {
    const references: Array<{ field: string; value: string | null | undefined }> = [];
    if (rule.actorType === "USER") references.push({ field: "assigneeId", value: rule.actorId });
    for (const condition of rule.conditions) {
      if (condition.operator === "is_empty" || condition.operator === "is_not_empty") continue;
      references.push({ field: condition.field, value: condition.value });
      if (condition.operator === "changed_from_to" || condition.operator === "changed_to") references.push({ field: condition.field, value: condition.fromValue });
    }
    for (const action of rule.actions) {
      if (action.valueType === "null") continue;
      if (action.valueType === "actor") {
        if (action.field !== "assigneeId") throw new ValidationError(`Triggering user cannot be used for ${action.field} in the destination project`);
        continue;
      }
      references.push({ field: action.field, value: action.value });
    }
    for (const reference of references) {
      if (!reference.value) continue;
      if (reference.field === "phaseId") {
        const phase = await r.phases.findById(reference.value);
        if (!phase || phase.projectId !== projectId) throw new ValidationError("A referenced phase is not in the destination project. Remove or replace phase references before copying.");
      }
      if (reference.field === "assigneeId" && !(await r.memberships.isMember(projectId, reference.value))) {
        throw new ValidationError("A referenced user is not a member of the destination project. Add the user or change the reference before copying.");
      }
    }
  }
  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId) throw new ForbiddenError("Only project owners can manage automations"); return project; }
  private validate(input: Partial<AutomationCreate>, availableStatuses: TaskEntity["status"][]) { if (!input.actions?.length) throw new ValidationError("Automation must have at least one action"); if (input.actorType === "USER" && !input.actorId) throw new ValidationError("A user actor is required"); if (input.actorType === "SERVICE" && !input.service) throw new ValidationError("A service actor is required"); const invalidTransition = (input.conditions ?? []).find((condition) => condition.operator === "changed_from_to" && !condition.fromValue); if (invalidTransition) throw new ValidationError("A changed_from_to condition requires a previous value"); const configured = [...(input.conditions ?? []), ...(input.actions ?? [])].flatMap((item) => item.field === "status" ? [item.value, "fromValue" in item ? item.fromValue : null] : []).filter((status): status is string => Boolean(status)); const unavailable = configured.find((status) => !availableStatuses.includes(status as TaskEntity["status"])); if (unavailable) throw new ValidationError(`Status ${unavailable} is not available in this project`); }
}

type Trigger = "TASK_CREATED" | "TASK_UPDATED";
const value = (task: TaskEntity, field: string): unknown => task[field as keyof TaskEntity];
const empty = (v: unknown) => v === null || v === undefined || v === "";

export class AutomationFailureError extends Error {
  constructor(public readonly auditEvent: { projectId: string; taskId: string; actorId: string; action: string; metadata: Record<string, unknown> }, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AutomationFailureError";
  }
}

export class AutomationEngine {
  async apply(r: RepositorySet, context: RequestContext, before: TaskEntity | null, after: TaskEntity, trigger: Trigger) {
    if (!r.automations) return after;
    const rules = await r.automations.listForProject(after.projectId);
    let current = after;
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger !== trigger || !this.actorMatches(rule, context) || !rule.conditions.every((c) => this.condition(c, before ? value(before, c.field) : undefined, value(current, c.field)))) continue;
      const patch: Record<string, unknown> = {};
      for (const action of rule.actions) patch[action.field] = action.valueType === "actor" ? context.actor.userId : action.valueType === "null" ? null : action.valueType === "static" ? action.value : action.value;
      if (Object.keys(patch).length) {
        try {
          current = await r.tasks.update(current.id, patch);
          await r.activity.record({
            projectId: current.projectId,
            taskId: current.id,
            actorId: context.actor.userId,
            action: "automation.applied",
            metadata: { automationId: rule.id, trigger, patch },
          });
        } catch (error) {
          throw new AutomationFailureError({
            projectId: after.projectId,
            taskId: after.id,
            actorId: context.actor.userId,
            action: "automation.failed",
            metadata: {
              automationId: rule.id,
              trigger,
              error: error instanceof Error ? error.message : String(error),
            },
          }, error);
        }
      }
    }
    return current;
  }
  private actorMatches(rule: AutomationEntity, context: RequestContext) { return rule.actorType === "ANY" || (rule.actorType === "USER" && rule.actorId === context.actor.userId) || (rule.actorType === "SERVICE" && context.actor.kind === "AGENT" && (!rule.service || rule.service === "agent-api")); }
  private condition(c: AutomationEntity["conditions"][number], oldValue: unknown, newValue: unknown) { const a = c.value; switch (c.operator) { case "equals": return String(newValue ?? "") === String(a ?? ""); case "not_equals": return String(newValue ?? "") !== String(a ?? ""); case "changed_to": return String(oldValue ?? "") !== String(newValue ?? "") && String(newValue ?? "") === String(a ?? "") && (c.fromValue == null || String(oldValue ?? "") === c.fromValue); case "changed_from_to": return String(oldValue ?? "") === String(c.fromValue ?? "") && String(newValue ?? "") === String(a ?? "") && String(oldValue ?? "") !== String(newValue ?? ""); case "is_empty": return empty(newValue); case "is_not_empty": return !empty(newValue); } }
}
