import { randomUUID } from "node:crypto";
import type { AutomationCreate, AutomationUpdate } from "@taskforge/contracts";
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
  private async authorize(r: RepositorySet, context: RequestContext, projectId: string) { const project = await r.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && context.actor.userId !== project.ownerId) throw new ForbiddenError("Only project owners can manage automations"); return project; }
  private validate(input: Partial<AutomationCreate>, availableStatuses: TaskEntity["status"][]) { if (!input.actions?.length) throw new ValidationError("Automation must have at least one action"); if (input.actorType === "USER" && !input.actorId) throw new ValidationError("A user actor is required"); if (input.actorType === "SERVICE" && !input.service) throw new ValidationError("A service actor is required"); const configured = [...(input.conditions ?? []), ...(input.actions ?? [])].filter((item) => item.field === "status" && item.value).map((item) => item.value!); const unavailable = configured.find((status) => !availableStatuses.includes(status as TaskEntity["status"])); if (unavailable) throw new ValidationError(`Status ${unavailable} is not available in this project`); }
}

type Trigger = "TASK_CREATED" | "TASK_UPDATED";
const value = (task: TaskEntity, field: string): unknown => task[field as keyof TaskEntity];
const empty = (v: unknown) => v === null || v === undefined || v === "";
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
          await r.activity.record({
            projectId: after.projectId,
            taskId: after.id,
            actorId: context.actor.userId,
            action: "automation.failed",
            metadata: {
              automationId: rule.id,
              trigger,
              error: error instanceof Error ? error.message : String(error),
            },
          }).catch(() => undefined);
          throw error;
        }
      }
    }
    return current;
  }
  private actorMatches(rule: AutomationEntity, context: RequestContext) { return rule.actorType === "ANY" || (rule.actorType === "USER" && rule.actorId === context.actor.userId) || (rule.actorType === "SERVICE" && context.actor.kind === "AGENT" && (!rule.service || rule.service === "agent-api")); }
  private condition(c: AutomationEntity["conditions"][number], oldValue: unknown, newValue: unknown) { const a = c.value; switch (c.operator) { case "equals": return String(newValue ?? "") === String(a ?? ""); case "not_equals": return String(newValue ?? "") !== String(a ?? ""); case "changed_to": return String(oldValue ?? "") !== String(newValue ?? "") && String(newValue ?? "") === String(a ?? ""); case "is_empty": return empty(newValue); case "is_not_empty": return !empty(newValue); } }
}
