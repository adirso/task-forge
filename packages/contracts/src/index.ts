import { z } from "zod";

export const userKindSchema = z.enum(["HUMAN", "AGENT"]);
export const userRoleSchema = z.enum(["ADMIN", "MEMBER"]);
export const projectMemberRoleSchema = z.enum(["OWNER", "MEMBER"]);
// Keep the canonical order aligned with the delivery workflow. Project subsets
// are normalized against this list, so this also controls board column order.
export const TASK_STATUSES = ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "FIX_NEEDED", "FIX_IN_PROGRESS", "RE_REVIEW", "APPROVED", "PENDING_DECISION", "CANCELLED", "FAILED", "DONE"] as const;
export const DEFAULT_PROJECT_STATUSES = ["BACKLOG", "REFINING", "TODO", "IN_PROGRESS", "READY_FOR_REVIEW", "IN_REVIEW", "CANCELLED", "DONE"] as const;
export const TASK_CLAIM_SOURCE_STATUSES = ["BACKLOG", "TODO"] as const;
export const TASK_CLAIM_TARGET_STATUS = "IN_PROGRESS" as const;
export const TASK_REVIEW_STATUSES = ["READY_FOR_REVIEW", "IN_REVIEW", "RE_REVIEW"] as const;
export const TASK_COMPLETION_STATUS = "DONE" as const;
export const DEPENDENCY_RESOLUTION_STATUSES = ["DONE", "CANCELLED"] as const;
export const DEFAULT_DEPENDENCY_RESOLUTION_STATUSES = [...DEPENDENCY_RESOLUTION_STATUSES] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const dependencyResolutionStatusSchema = z.enum(DEPENDENCY_RESOLUTION_STATUSES);
export const dependencyResolutionStatusesSchema = z.array(dependencyResolutionStatusSchema)
  .min(1, "DONE must resolve task dependencies")
  .max(DEPENDENCY_RESOLUTION_STATUSES.length)
  .refine((statuses) => new Set(statuses).size === statuses.length, "Dependency resolution statuses must be unique")
  .refine((statuses) => statuses.includes("DONE"), "DONE must resolve task dependencies")
  .transform((statuses) => DEPENDENCY_RESOLUTION_STATUSES.filter((status) => statuses.includes(status)));
export type DependencyResolutionStatus = z.infer<typeof dependencyResolutionStatusSchema>;
export const projectAvailableStatusesSchema = z.array(taskStatusSchema)
  .min(1, "At least one status must be available")
  .max(TASK_STATUSES.length)
  .refine((statuses) => new Set(statuses).size === statuses.length, "Statuses must be unique")
  .transform((statuses) => TASK_STATUSES.filter((status) => statuses.includes(status)));
export const agentWorkflowSchema = z.object({
  implementationQueue: taskStatusSchema,
  implementationStart: taskStatusSchema,
  reviewHandoff: taskStatusSchema,
  reviewStart: taskStatusSchema,
  approved: taskStatusSchema,
  fixNeeded: taskStatusSchema,
  fixStart: taskStatusSchema,
  reReview: taskStatusSchema,
});
export const projectMergeTargetSchema = z.enum(["main", "phase"]);
export type ProjectMergeTarget = z.infer<typeof projectMergeTargetSchema>;
export const projectReviewPolicySchema = z.object({
  requireIndependentReview: z.boolean(),
  requiredReviewerCount: z.number().int().min(1).max(10),
  allowedReviewerAgentIds: z.array(z.string().uuid()).max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Allowed reviewer agents must be unique"),
}).superRefine((policy, context) => {
  if (policy.allowedReviewerAgentIds.length > 0 && policy.requiredReviewerCount > policy.allowedReviewerAgentIds.length) {
    context.addIssue({ code: "custom", path: ["requiredReviewerCount"], message: "Reviewer count cannot exceed the allowed reviewer agent count" });
  }
});
export type ProjectReviewPolicy = z.infer<typeof projectReviewPolicySchema>;
export const DEFAULT_PROJECT_REVIEW_POLICY: ProjectReviewPolicy = {
  requireIndependentReview: true,
  requiredReviewerCount: 1,
  allowedReviewerAgentIds: [],
};
export function phaseBranchName(projectKey: string, phaseNumber: number) {
  return `phase/${projectKey.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${phaseNumber}`;
}
export type AgentWorkflow = z.infer<typeof agentWorkflowSchema>;
export const DEFAULT_AGENT_WORKFLOW: AgentWorkflow = {
  implementationQueue: "TODO",
  implementationStart: "IN_PROGRESS",
  reviewHandoff: "READY_FOR_REVIEW",
  reviewStart: "IN_REVIEW",
  approved: "APPROVED",
  fixNeeded: "FIX_NEEDED",
  fixStart: "FIX_IN_PROGRESS",
  reReview: "RE_REVIEW",
};
export const taskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const TASK_TYPES = ["FEATURE", "BUG", "INFRA", "UPDATE", "SECURITY", "DOCS", "CHORE"] as const;
export const taskTypeSchema = z.enum(TASK_TYPES);
export const agentAvailabilitySchema = z.enum(["AVAILABLE", "PAUSED"]);
export const agentHealthSchema = z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]);
const normalizedCapabilityList = (maximum: number) => z.array(z.string().trim().min(1).max(160)).max(maximum)
  .transform((values) => [...new Set(values.map((value) => value.toLowerCase()))].sort());
const repositoryCapabilitySchema = z.string().trim().min(1).max(300).superRefine((value, context) => {
  if (value === "*") return;
  if (/^[^\s/:]+\/[^\s/]+(?:\/[^\s/]+)?$/.test(value) || /^git@[^:]+:[^\s/]+\/[^\s/]+(?:\.git)?$/.test(value)) return;
  try {
    const url = new URL(value);
    if (["http:", "https:", "ssh:"].includes(url.protocol) && !url.username && !url.password && url.hostname && url.pathname.split("/").filter(Boolean).length >= 2) return;
  } catch { /* Report one stable validation issue below. */ }
  context.addIssue({ code: "custom", message: "Repositories must be *, owner/repository, host/owner/repository, or a credential-free repository URL" });
});
export const agentCapabilityProfileSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(120),
  skills: normalizedCapabilityList(50),
  taskTypes: z.array(taskTypeSchema).min(1).max(TASK_TYPES.length)
    .refine((values) => new Set(values).size === values.length, "Task types must be unique")
    .transform((values) => TASK_TYPES.filter((value) => values.includes(value))),
  repositories: z.array(repositoryCapabilitySchema).min(1, "At least one repository is required").max(50)
    .transform((values) => [...new Set(values.map((value) => value.toLowerCase()))].sort()),
  maxConcurrency: z.number().int().min(1).max(32),
  availability: agentAvailabilitySchema,
  health: agentHealthSchema,
});
export const agentRoutingSchema = z.object({
  requiredSkills: normalizedCapabilityList(20).optional().default([]),
  overrideAgentId: z.string().uuid().optional(),
});
export const pullRequestStateSchema = z.enum(["DRAFT", "OPEN", "MERGED", "CLOSED"]);
export const agentRunControlStateSchema = z.enum(["ACTIVE", "PAUSED", "WAITING_FOR_INPUT", "HUMAN_TAKEOVER"]);
export const agentRunInterventionActionSchema = z.enum(["PAUSE", "RESUME", "CANCEL", "RETRY", "REASSIGN", "REQUEST_INPUT", "ANSWER", "TAKEOVER"]);
export const agentRunInterventionSchema = z.object({
  action: agentRunInterventionActionSchema,
  controlVersion: z.number().int().nonnegative(),
  agentId: z.string().uuid().optional(),
  input: z.string().trim().min(1).max(4000).optional(),
}).superRefine((value, context) => {
  if (value.action === "REASSIGN" && !value.agentId) context.addIssue({ code: "custom", path: ["agentId"], message: "agentId is required when reassigning a run" });
  if (["REQUEST_INPUT", "ANSWER"].includes(value.action) && !value.input) context.addIssue({ code: "custom", path: ["input"], message: "input is required for this intervention" });
});

export const agentUsageEventInputSchema = z.object({
  eventId: z.string().trim().min(1).max(180),
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(120),
  inputTokens: z.number().int().nonnegative().max(1_000_000_000).default(0),
  outputTokens: z.number().int().nonnegative().max(1_000_000_000).default(0),
  costMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  toolCalls: z.number().int().nonnegative().max(1_000_000).default(0),
  runtimeMs: z.number().int().nonnegative().max(86_400_000).default(0),
});
export type AgentUsageEventInput = z.infer<typeof agentUsageEventInputSchema>;
export const agentBudgetScopeSchema = z.enum(["PROJECT", "PHASE", "TASK"]);
export const agentBudgetActionSchema = z.enum(["WARN", "PAUSE", "BLOCK"]);
export const agentBudgetLimitsSchema = z.object({
  totalTokens: z.number().int().positive().optional(),
  costMicros: z.number().int().positive().optional(),
  toolCalls: z.number().int().positive().optional(),
  runtimeMs: z.number().int().positive().optional(),
  retries: z.number().int().positive().optional(),
  forcedCycles: z.number().int().positive().optional(),
}).refine((limits) => Object.keys(limits).length > 0, "At least one budget limit is required");
export const agentBudgetUpsertSchema = z.object({
  action: agentBudgetActionSchema,
  limits: agentBudgetLimitsSchema,
});
export type AgentBudgetScope = z.infer<typeof agentBudgetScopeSchema>;
export type AgentBudgetAction = z.infer<typeof agentBudgetActionSchema>;
export type AgentBudgetLimits = z.infer<typeof agentBudgetLimitsSchema>;
export type AgentBudgetUpsert = z.infer<typeof agentBudgetUpsertSchema>;
export interface AgentUsageTotals { inputTokens: number; outputTokens: number; totalTokens: number; costMicros: number; toolCalls: number; runtimeMs: number; retries: number; forcedCycles: number; runCount: number; eventCount: number; }
export interface AgentUsageBreakdown extends AgentUsageTotals { key: string; }
export interface AgentUsageReport { total: AgentUsageTotals; byRun: AgentUsageBreakdown[]; byTask: AgentUsageBreakdown[]; byPhase: AgentUsageBreakdown[]; byProject: AgentUsageBreakdown[]; byProvider: AgentUsageBreakdown[]; byModel: AgentUsageBreakdown[]; }
export interface AgentBudget { id: string; projectId: string; scope: AgentBudgetScope; scopeId: string; action: AgentBudgetAction; limits: AgentBudgetLimits; createdAt: string; updatedAt: string; }

export const agentArtifactTypeSchema = z.enum([
  "CHANGED_FILES", "COMMIT", "TEST_RESULT", "COVERAGE", "SCREENSHOT", "TOOL_OUTCOME", "PROMPT", "MODEL", "EXECUTION_ENVIRONMENT",
]);
const artifactSha = z.string().regex(/^[0-9a-f]{7,64}$/i);
const artifactPath = z.string().trim().min(1).max(2048).refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "Artifact file paths must be repository-relative");
const artifactCommon = {
  name: z.string().trim().min(1).max(180),
  headSha: artifactSha,
  mediaType: z.string().trim().min(1).max(160),
  data: z.string().min(1).max(7_000_000),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
};
export const agentArtifactCreateSchema = z.discriminatedUnion("type", [
  z.object({ ...artifactCommon, type: z.literal("CHANGED_FILES"), metadata: z.object({ files: z.array(artifactPath).min(1).max(1_000) }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("COMMIT"), metadata: z.object({ sha: artifactSha, message: z.string().trim().max(500).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("TEST_RESULT"), metadata: z.object({ command: z.string().trim().min(1).max(1_000), status: z.enum(["PASS", "FAIL"]), durationMs: z.number().int().nonnegative().max(86_400_000).optional(), summary: z.string().trim().max(2_000).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("COVERAGE"), metadata: z.object({ format: z.enum(["SUMMARY", "LCOV", "COBERTURA"]), lines: z.number().min(0).max(100).optional(), branches: z.number().min(0).max(100).optional(), functions: z.number().min(0).max(100).optional(), statements: z.number().min(0).max(100).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("SCREENSHOT"), metadata: z.object({ width: z.number().int().positive().max(20_000).optional(), height: z.number().int().positive().max(20_000).optional(), description: z.string().trim().max(1_000).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("TOOL_OUTCOME"), metadata: z.object({ tool: z.string().trim().min(1).max(160), status: z.enum(["PASS", "FAIL"]), summary: z.string().trim().max(2_000).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("PROMPT"), metadata: z.object({ version: z.string().trim().min(1).max(120) }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("MODEL"), metadata: z.object({ provider: z.string().trim().min(1).max(64), model: z.string().trim().min(1).max(120), version: z.string().trim().max(120).optional() }).strict() }),
  z.object({ ...artifactCommon, type: z.literal("EXECUTION_ENVIRONMENT"), metadata: z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/i), platform: z.string().trim().min(1).max(64).optional(), architecture: z.string().trim().min(1).max(64).optional(), runtime: z.string().trim().max(120).optional() }).strict() }),
]);
export type AgentArtifactType = z.infer<typeof agentArtifactTypeSchema>;
export type AgentArtifactCreate = z.infer<typeof agentArtifactCreateSchema>;
export type AgentArtifactMetadata = AgentArtifactCreate["metadata"];
export interface AgentArtifact {
  id: string; runId: string; taskId: string; projectId: string; headSha: string; type: AgentArtifactType;
  name: string; mediaType: string; size: number; contentHash: string; metadata: AgentArtifactMetadata;
  createdById: string; createdAt: string; downloadUrl: string;
}

export const agentPlanStatusSchema = z.enum(["PROPOSED", "APPROVED", "REJECTED"]);
export const agentPlanItemSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "Item keys may contain letters, numbers, underscores, and hyphens"),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).default(""),
  definitionOfDone: z.string().trim().max(10_000).default(""),
  priority: taskPrioritySchema.default("MEDIUM"),
  type: taskTypeSchema.default("FEATURE"),
  estimatePoints: z.number().int().min(0).max(100).nullable().default(null),
  dependencyKeys: z.array(z.string().trim().min(1).max(64)).max(50).default([])
    .refine((keys) => new Set(keys).size === keys.length, "Dependencies must be unique"),
});
export const agentPlanProposalSchema = z.object({
  sourceRunId: z.string().uuid(),
  summary: z.string().trim().min(1).max(10_000),
  risks: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  acceptanceEvidence: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  requiresApproval: z.boolean().default(true),
  items: z.array(agentPlanItemSchema).min(1).max(50),
}).superRefine((plan, context) => {
  const keys = new Set(plan.items.map((item) => item.key));
  if (keys.size !== plan.items.length) context.addIssue({ code: "custom", path: ["items"], message: "Item keys must be unique" });
  for (const [index, item] of plan.items.entries()) {
    for (const dependency of item.dependencyKeys) {
      if (!keys.has(dependency)) context.addIssue({ code: "custom", path: ["items", index, "dependencyKeys"], message: `Unknown dependency key: ${dependency}` });
      if (dependency === item.key) context.addIssue({ code: "custom", path: ["items", index, "dependencyKeys"], message: "An item cannot depend on itself" });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dependencies = new Map(plan.items.map((item) => [item.key, item.dependencyKeys]));
  const cyclic = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) if (cyclic(dependency)) return true;
    visiting.delete(key); visited.add(key); return false;
  };
  if (plan.items.some((item) => cyclic(item.key))) context.addIssue({ code: "custom", path: ["items"], message: "Plan dependencies must be acyclic" });
});
export const agentPlanDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(4000).nullable().optional(),
});

export const AGENT_CONTEXT_PACK_SCHEMA_VERSION = 1 as const;
const contextPackTextSchema = z.string().max(10_000);
export const agentContextPackContentSchema = z.object({
  schemaVersion: z.literal(AGENT_CONTEXT_PACK_SCHEMA_VERSION),
  task: z.object({
    id: z.string(), projectKey: z.string(), number: z.number().int().positive(), title: contextPackTextSchema,
    description: contextPackTextSchema, definitionOfDone: contextPackTextSchema, status: taskStatusSchema,
    priority: taskPrioritySchema, type: taskTypeSchema, branch: contextPackTextSchema.nullable(), phaseId: z.string().nullable(),
  }),
  project: z.object({
    id: z.string(), key: z.string(), name: contextPackTextSchema, repositoryUrl: contextPackTextSchema.nullable(),
    availableStatuses: z.array(taskStatusSchema), mergeTarget: projectMergeTargetSchema,
  }),
  dependencies: z.array(z.object({
    taskId: z.string(), projectKey: z.string(), number: z.number().int().positive(), title: contextPackTextSchema,
    status: taskStatusSchema, isBlocking: z.boolean(),
  })),
  attachments: z.array(z.object({
    id: z.string(), fileName: contextPackTextSchema, mimeType: contextPackTextSchema, size: z.number().int().nonnegative(), downloadUrl: contextPackTextSchema,
  })),
  repository: z.object({ guidanceFiles: z.array(contextPackTextSchema), relevantFiles: z.array(contextPackTextSchema) }),
  history: z.object({
    decisions: z.array(z.object({ id: z.string(), body: contextPackTextSchema, createdAt: z.string() })),
    recentUpdates: z.array(z.object({ id: z.string(), body: contextPackTextSchema, createdAt: z.string() })),
    findings: z.array(z.object({
      id: z.string(), severity: z.enum(["P0", "P1", "P2", "P3"]), title: contextPackTextSchema,
      body: contextPackTextSchema, disposition: z.string(), dispositionReason: contextPackTextSchema.nullable(),
      filePath: contextPackTextSchema.nullable(), lineNumber: z.number().int().positive().nullable(), updatedAt: z.string(),
    })),
    priorRuns: z.array(z.object({ id: z.string(), kind: z.string(), status: z.string(), lastError: contextPackTextSchema.nullable(), completedAt: z.string().nullable() })),
    summary: z.object({ totalUpdates: z.number().int().nonnegative(), includedUpdates: z.number().int().nonnegative(), omittedUpdates: z.number().int().nonnegative(), omittedSummary: contextPackTextSchema.nullable() }),
  }),
});
export const agentContextPackSchema = z.object({
  id: z.string(), runId: z.string(), taskId: z.string(), projectId: z.string(),
  version: z.number().int().positive(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  content: agentContextPackContentSchema, refreshedFromVersion: z.number().int().positive().nullable(),
  refreshReason: z.enum(["INITIAL", "EXPLICIT_REFRESH"]), createdById: z.string(), createdAt: z.string(),
});
export const agentContextPackRefreshSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});
/** Pull requests are intentionally restricted to canonical public GitHub URLs. */
export const deliveryMonitorPullRequestSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  number: z.number().int().positive(),
  url: z.string().url(),
});
export const deliveryMonitorErrorCategorySchema = z.enum([
  "AUTHENTICATION", "PERMISSION", "RATE_LIMIT", "NOT_FOUND", "INVALID_URL", "NETWORK", "TIMEOUT", "UNKNOWN",
]);
export const deliveryMonitorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  githubAppId: z.string().trim().min(1).optional(),
  githubInstallationId: z.string().trim().min(1).optional(),
  githubPrivateKey: z.string().trim().min(1).optional(),
  pollIntervalMs: z.number().int().min(5_000).max(900_000).default(60_000),
  batchSize: z.number().int().min(1).max(500).default(100),
  leaseDurationMs: z.number().int().min(5_000).max(900_000).default(120_000),
  maxRetries: z.number().int().min(0).max(20).default(5),
}).superRefine((value, context) => {
  const configured = [value.githubAppId, value.githubInstallationId, value.githubPrivateKey].filter(Boolean).length;
  if (configured > 0 && configured < 3) context.addIssue({ code: "custom", path: ["githubAppId"], message: "githubAppId, githubInstallationId, and githubPrivateKey must be configured together" });
});
export const deliveryMonitorSyncResultSchema = z.object({
  taskId: z.string().uuid(),
  pullRequestUrl: z.string().url(),
  state: pullRequestStateSchema,
  observedAt: z.string().datetime(),
  destinationStatus: z.enum(["DONE", "CANCELLED"]).nullable(),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).nullable(),
  errorCategory: deliveryMonitorErrorCategorySchema.nullable(),
});
export const deliveryMonitorCheckpointSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  pullRequestUrl: z.string().url(),
  cursor: z.string().nullable(),
  etag: z.string().max(512).nullable().default(null),
  retryCount: z.number().int().nonnegative().default(0),
  nextAttemptAt: z.string().datetime().nullable().default(null),
  observedAt: z.string().datetime(),
  lastState: pullRequestStateSchema.nullable().default(null),
  lastError: deliveryMonitorErrorCategorySchema.nullable().default(null),
  lastResult: deliveryMonitorSyncResultSchema.nullable(),
});
export const deliveryMonitorLeaseSchema = z.object({
  runId: z.string().uuid(),
  ownerId: z.string().min(1),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const deliveryMonitorAuditEventSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  event: z.enum(["SYNC_STARTED", "SYNC_COMPLETED", "SYNC_FAILED", "LEASE_UNAVAILABLE"]),
  occurredAt: z.string().datetime(),
  errorCategory: deliveryMonitorErrorCategorySchema.nullable(),
});
export const deliveryMonitorHealthSchema = z.object({
  status: z.enum(["healthy", "stale", "idle", "unavailable"]),
  lastSweepAt: z.string().datetime().nullable(),
  activeLeaseCount: z.number().int().nonnegative(),
  processedCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().datetime().nullable(),
  failures: z.array(z.object({
    runId: z.string().uuid(), taskId: z.string().uuid(), pullRequestUrl: z.string().url(),
    retryCount: z.number().int().nonnegative(), nextRetryAt: z.string().datetime().nullable(),
    lastObservedAt: z.string().datetime().nullable(), state: z.string().nullable(), errorCategory: z.string().nullable(),
  })),
});
export const webhookEventTypeSchema = z.enum(["task.assigned", "task.update_added", "task.status_changed"]);
export const webhookDeliveryStatusSchema = z.enum(["PENDING", "RETRYING", "DELIVERED", "FAILED"]);
export const taskTagNameSchema = z.string().trim().min(1).max(32)
  .regex(/^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/, "Tags may contain letters, numbers, hyphens, and underscores")
  .transform((value) => value.toLowerCase());
export const taskTagsSchema = z.array(taskTagNameSchema).max(20)
  .transform((values) => [...new Set(values)]);
export const taskDependencyIdsSchema = z.array(z.string().uuid()).max(50)
  .transform((values) => [...new Set(values)]);
export const taskDependencyUpdateSchema = z.object({ dependencyIds: taskDependencyIdsSchema });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const projectCreateSchema = z.object({
  key: z.string().trim().min(2).max(8).regex(/^[A-Za-z][A-Za-z0-9]*$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  repoUrl: z.string().url().nullable().optional(),
  localRepoPath: z.string().trim().min(1).max(2048).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6554C0"),
});

export const projectUpdateSchema = projectCreateSchema.omit({ key: true }).partial().extend({
  availableStatuses: projectAvailableStatusesSchema.optional(),
  defaultStatus: taskStatusSchema.optional(),
  agentWorkflow: agentWorkflowSchema.nullable().optional(),
  hiddenEmptyStatuses: projectAvailableStatusesSchema.optional(),
  mergeTarget: projectMergeTargetSchema.optional(),
  dependencyResolutionStatuses: dependencyResolutionStatusesSchema.optional(),
  reviewPolicy: projectReviewPolicySchema.optional(),
});
export const projectOrderSchema = z.object({ projectIds: z.array(z.string().uuid()).min(1).max(500) });

export const phaseCreateSchema = z.object({
  number: z.number().int().min(1).max(10000),
  goal: z.string().trim().min(1).max(1000),
  isActive: z.boolean().default(false),
});

export const phaseUpdateSchema = phaseCreateSchema.partial();

export const phaseDeleteSchema = z.object({
  taskAction: z.enum(["move", "delete"]).optional(),
  targetPhaseId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.taskAction === "move" && !value.targetPhaseId) {
    context.addIssue({ code: "custom", path: ["targetPhaseId"], message: "Choose a phase to move tasks into" });
  }
  if (value.targetPhaseId && value.taskAction !== "move") {
    context.addIssue({ code: "custom", path: ["taskAction"], message: "taskAction must be move when targetPhaseId is set" });
  }
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10000).default(""),
  definitionOfDone: z.string().trim().max(10000).default(""),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.default("MEDIUM"),
  type: taskTypeSchema.default("FEATURE"),
  assigneeId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  branch: z.string().trim().max(255).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  estimatePoints: z.number().int().min(0).max(100).nullable().optional(),
  phaseId: z.string().uuid().nullable().optional(),
  pullRequestUrl: z.string().url().nullable().optional(),
  pullRequestTitle: z.string().trim().max(240).nullable().optional(),
  pullRequestState: pullRequestStateSchema.nullable().optional(),
  tags: taskTagsSchema.optional(),
  dependencyIds: taskDependencyIdsSchema.optional(),
});

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
  runId: z.string().uuid().nullable().optional(),
});

export const memberAddSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
});

export const agentCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().optional(),
});

export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;
export type AgentHealth = z.infer<typeof agentHealthSchema>;
export type AgentCapabilityProfile = z.infer<typeof agentCapabilityProfileSchema>;
export type AgentRoutingRequest = z.infer<typeof agentRoutingSchema>;

export const agentWebhookSchema = z.object({
  webhookUrl: z.string().url().nullable().superRefine((value, context) => {
    if (!value) return;
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) context.addIssue({ code: "custom", message: "Webhook URLs must use HTTP or HTTPS" });
    if (url.username || url.password) context.addIssue({ code: "custom", message: "Webhook URLs must not contain credentials" });
  }),
});

export const webhookDeliveryQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  status: webhookDeliveryStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const taskClaimSchema = z.object({
  phaseId: z.string().uuid().nullable().optional(),
  priority: taskPrioritySchema.optional(),
  runId: z.string().uuid().nullable().optional(),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
});

export const TOKEN_SCOPES = [
  "task:read",
  "task:create",
  "task:delete",
  "task:claim",
  "task:update:status",
  "task:update:notes",
  "task:update:branch",
  "task:update:meta",
  "task:gate:evidence",
  "task:gate:approve",
  "task:plan",
  "task:artifact",
] as const;
export type TokenScope = typeof TOKEN_SCOPES[number];

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  permissions: z.array(z.enum(TOKEN_SCOPES)).nullable().optional(),
});

export const taskUpdateCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  data: z.string().min(1).max(35_000_000),
});

export const avatarUploadSchema = z.object({
  mimeType: z.string().regex(/^image\/(png|jpeg|jpg|gif|webp)$/i, "Profile pictures must be PNG, JPEG, GIF, or WebP images"),
  data: z.string().min(1).max(4_000_000),
});

export const automationFieldSchema = z.enum(["status", "priority", "type", "assigneeId", "pullRequestState", "phaseId", "branch", "estimatePoints"]);
export const automationOperatorSchema = z.enum(["equals", "not_equals", "changed_to", "changed_from_to", "is_empty", "is_not_empty"]);
export const automationConditionSchema = z.object({ field: automationFieldSchema, operator: automationOperatorSchema, value: z.string().nullable().default(null), fromValue: z.string().nullable().optional() });
export const automationValueTypeSchema = z.enum(["static", "actor", "user", "service", "null"]);
export const automationActionSchema = z.object({ field: automationFieldSchema, valueType: automationValueTypeSchema, value: z.string().nullable().default(null) });
export const automationCreateSchema = z.object({ name: z.string().trim().min(2).max(120), enabled: z.boolean().default(true), trigger: z.enum(["TASK_CREATED", "TASK_UPDATED"]).default("TASK_UPDATED"), actorType: z.enum(["ANY", "USER", "SERVICE"]).default("ANY"), actorId: z.string().uuid().nullable().optional(), service: z.string().trim().max(80).nullable().optional(), conditions: z.array(automationConditionSchema).max(10).default([]), actions: z.array(automationActionSchema).min(1).max(10) });
export const automationUpdateSchema = automationCreateSchema.partial();

export type UserKind = z.infer<typeof userKindSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type ProjectMemberRole = z.infer<typeof projectMemberRoleSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;
export type AgentRunControlState = z.infer<typeof agentRunControlStateSchema>;
export type AgentRunInterventionAction = z.infer<typeof agentRunInterventionActionSchema>;
export type AgentRunIntervention = z.infer<typeof agentRunInterventionSchema>;
export type AgentPlanStatus = z.infer<typeof agentPlanStatusSchema>;
export type AgentPlanItem = z.infer<typeof agentPlanItemSchema>;
export type AgentPlanProposal = z.infer<typeof agentPlanProposalSchema>;
export type AgentPlanDecision = z.infer<typeof agentPlanDecisionSchema>;
export type AgentContextPackContent = z.infer<typeof agentContextPackContentSchema>;
export type AgentContextPack = z.infer<typeof agentContextPackSchema>;
export type AgentContextPackRefresh = z.infer<typeof agentContextPackRefreshSchema>;
export type DeliveryMonitorConfig = z.infer<typeof deliveryMonitorConfigSchema>;
export type DeliveryMonitorPullRequest = z.infer<typeof deliveryMonitorPullRequestSchema>;
export type DeliveryMonitorErrorCategory = z.infer<typeof deliveryMonitorErrorCategorySchema>;
export type DeliveryMonitorSyncResult = z.infer<typeof deliveryMonitorSyncResultSchema>;
export type DeliveryMonitorCheckpoint = z.infer<typeof deliveryMonitorCheckpointSchema>;
export type DeliveryMonitorLease = z.infer<typeof deliveryMonitorLeaseSchema>;
export type DeliveryMonitorAuditEvent = z.infer<typeof deliveryMonitorAuditEventSchema>;
export type DeliveryMonitorHealth = z.infer<typeof deliveryMonitorHealthSchema>;

const GITHUB_PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;
export function parseDeliveryMonitorPullRequestUrl(value: string): DeliveryMonitorPullRequest | null {
  const match = GITHUB_PR_URL.exec(value.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const url = `https://github.com/${match[1]}/${match[2]}/pull/${number}`;
  return deliveryMonitorPullRequestSchema.parse({ owner: match[1], repository: match[2], number, url });
}

export function mapGithubPullRequestState(state: "open" | "closed", mergedAt: string | null, draft = false): PullRequestState {
  if (mergedAt) return "MERGED";
  if (state === "closed") return "CLOSED";
  return draft ? "DRAFT" : "OPEN";
}

/** Ensure a project can receive every terminal result produced by the monitor. */
export function validateDeliveryMonitorDestinations(availableStatuses: readonly string[]): { merged: "DONE"; closed: "CANCELLED" } {
  const missing = (["DONE", "CANCELLED"] as const).filter((status) => !availableStatuses.includes(status));
  if (missing.length) throw new Error(`Delivery Monitor requires enabled destination status(es): ${missing.join(", ")}`);
  return { merged: "DONE", closed: "CANCELLED" };
}
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type AutomationCreate = z.infer<typeof automationCreateSchema>;
export type AutomationUpdate = z.infer<typeof automationUpdateSchema>;

export interface User {
  id: string;
  email: string | null;
  name: string;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
  webhookUrl?: string | null;
  webhookSecretConfigured?: boolean;
  capabilityProfile?: AgentCapabilityProfile | null;
  capabilityProfileError?: string | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  agentId: string;
  agentName: string;
  taskId: string | null;
  taskNumber: number | null;
  projectKey: string | null;
  eventType: WebhookEventType;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  httpStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember extends User {
  projectRole: ProjectMemberRole;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  repoUrl: string | null;
  localRepoPath: string | null;
  color: string;
  sortOrder: number;
  availableStatuses: TaskStatus[];
  defaultStatus: TaskStatus;
  agentWorkflow: AgentWorkflow | null;
  hiddenEmptyStatuses: TaskStatus[];
  mergeTarget: ProjectMergeTarget;
  dependencyResolutionStatuses: DependencyResolutionStatus[];
  reviewPolicy: ProjectReviewPolicy;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  taskCount?: number;
  members?: ProjectMember[];
}

export interface Phase {
  id: string;
  projectId: string;
  number: number;
  goal: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  branchName?: string | null;
  taskCount?: number;
  nonDoneTaskCount?: number;
  completedTaskCount?: number;
  cancelledTaskCount?: number;
}

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  taskCount?: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
  projectId: string;
  projectKey: string;
  number: number;
  title: string;
  status: TaskStatus;
  isBlocking: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  definitionOfDone: string;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType;
  assigneeId: string | null;
  creatorId: string;
  parentId: string | null;
  branch: string | null;
  dueDate: string | null;
  estimatePoints: number | null;
  phaseId: string | null;
  pullRequestUrl: string | null;
  pullRequestTitle: string | null;
  pullRequestState: PullRequestState | null;
  statusDurations?: Partial<Record<TaskStatus, number>>;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee?: User | null;
  phase?: Phase | null;
  creator?: User;
  subtasks?: Task[];
  tags: Tag[];
  dependencies: TaskDependency[];
  blockedReason?: string | null;
  attachments: Attachment[];
  updates?: TaskNote[];
  updatesPage?: PageInfo;
}

export interface AgentPlan {
  id: string;
  taskId: string;
  sourceRunId: string;
  version: number;
  status: AgentPlanStatus;
  summary: string;
  risks: string[];
  acceptanceEvidence: string[];
  requiresApproval: boolean;
  items: AgentPlanItem[];
  createdTaskIds: Record<string, string>;
  proposedById: string;
  reviewedById: string | null;
  reviewComment: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AutomationCondition { field: z.infer<typeof automationFieldSchema>; operator: z.infer<typeof automationOperatorSchema>; value: string | null; fromValue?: string | null; }
export interface AutomationAction { field: z.infer<typeof automationFieldSchema>; valueType: z.infer<typeof automationValueTypeSchema>; value: string | null; }
export interface Automation { id: string; projectId: string; name: string; enabled: boolean; trigger: "TASK_CREATED" | "TASK_UPDATED"; actorType: "ANY" | "USER" | "SERVICE"; actorId: string | null; service: string | null; conditions: AutomationCondition[]; actions: AutomationAction[]; createdAt: string; updatedAt: string; }

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: User;
  downloadUrl: string;
}

export interface TaskNote {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: User;
}

export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Notification {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  projectName?: string | null;
  projectKey?: string | null;
  taskNumber?: number | null;
}

export interface TaskSearchResult extends Task {
  projectName: string;
  projectKey: string;
  projectColor: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  projectKey: string;
  taskId: string | null;
  taskNumber: number | null;
  actorId: string;
  actorName: string;
  actorKind: UserKind;
  actorAvatarUrl: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentOpsTask {
  id: string;
  title: string;
  number: number;
  projectId: string;
  projectName: string;
  projectKey: string;
  updatedAt: string;
  isStuck: boolean;
}

export interface AgentOpsEntry {
  id: string;
  name: string;
  email: string | null;
  kind: UserKind;
  role: UserRole;
  avatarUrl: string | null;
  webhookUrl: string | null;
  capabilityProfile: AgentCapabilityProfile | null;
  capabilityProfileError: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  openTaskCount: number;
  stuckTaskCount: number;
  inProgressTasks: AgentOpsTask[];
}

export interface DashboardSummaryProject {
  id: string;
  name: string;
  key: string;
  color: string;
  counts: Record<TaskStatus, number> & { total: number };
  nonDoneTaskCount: number;
  cancelledTaskCount: number;
  nonDonePhaseCount: number;
  agentUsage: AgentUsageTotals;
}

export interface DashboardSummaryTask {
  id: string;
  number: number;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  status: TaskStatus;
  assigneeName: string | null;
  updatedAt: string;
}

export interface DashboardSummary {
  projects: DashboardSummaryProject[];
  myTasks: DashboardSummaryTask[];
  stuckTasks: DashboardSummaryTask[];
}

export interface ApiTokenMetadata {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  revealable: boolean;
  permissions: TokenScope[] | null;
}
