import { createHash, randomUUID } from "node:crypto";
import { AGENT_CONTEXT_PACK_SCHEMA_VERSION, agentContextPackContentSchema, type AgentContextPackContent } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentContextPackEntity, AgentRunEntity, TaskEntity, TaskUpdateEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

const RECENT_UPDATE_LIMIT = 40;
const HISTORY_PAGE_SIZE = 500;
const DECISION_PATTERN = /\b(accept(?:ed)?|approv(?:e|ed|al)|cancel(?:led)?|decision|defer(?:red)?|handoff|merge(?:d)?|reject(?:ed)?|review|risk|block(?:ed|er)?|fix(?:ed| needed)?)\b/i;

export class AgentContextPackApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID) {}

  async get(context: RequestContext, runId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await this.authorize(repositories, context, runId, false);
      const pack = await repositories.contextPacks.findCurrent(run.id);
      if (!pack) throw new NotFoundError("Agent context pack");
      return pack;
    });
  }

  async list(context: RequestContext, runId: string) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await this.authorize(repositories, context, runId, false);
      return repositories.contextPacks.listForRun(run.id);
    });
  }

  async refresh(context: RequestContext, runId: string, reason?: string) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await this.authorize(repositories, context, runId, true);
      const pack = await persistContextPack(repositories, run, context.actor.userId, "EXPLICIT_REFRESH", this.now(), this.newId);
      await repositories.activity.record({ projectId: run.projectId, taskId: run.taskId, actorId: context.actor.userId, action: "agent_run.context_pack_refreshed", metadata: { runId, version: pack.version, fingerprint: pack.fingerprint, reason: reason ? redact(reason) : null } });
      return pack;
    });
  }

  private async authorize(repositories: RepositorySet, context: RequestContext, runId: string, refreshing: boolean) {
    const run = await repositories.runs.findById(runId);
    if (!run) throw new NotFoundError("Agent run");
    const project = await repositories.projects.findById(run.projectId);
    if (!project) throw new NotFoundError("Project");
    if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(run.projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project");
    if (context.actor.kind === "AGENT") {
      const belongsToRun = [run.assignedAgentId, run.executedById, run.leaseOwner].includes(context.actor.userId);
      if (!belongsToRun) throw new ForbiddenError("This agent is not assigned to the requested run");
      if (refreshing && (run.status !== "RUNNING" || run.controlState !== "ACTIVE" || run.leaseOwner !== context.actor.userId)) throw new ForbiddenError("Only the current run lease owner can refresh its context pack");
    }
    return run;
  }
}

export async function persistInitialContextPack(repositories: RepositorySet, run: AgentRunEntity, actorId: string, now: string, newId: () => string = randomUUID) {
  const existing = await repositories.contextPacks.findCurrent(run.id);
  if (existing) return existing;
  const pack = await persistContextPack(repositories, run, actorId, "INITIAL", now, newId);
  await repositories.activity.record({ projectId: run.projectId, taskId: run.taskId, actorId, action: "agent_run.context_pack_created", metadata: { runId: run.id, version: pack.version, fingerprint: pack.fingerprint } });
  return pack;
}

async function persistContextPack(repositories: RepositorySet, run: AgentRunEntity, actorId: string, refreshReason: AgentContextPackEntity["refreshReason"], now: string, newId: () => string) {
  const version = await repositories.contextPacks.nextVersion(run.id);
  const current = await repositories.contextPacks.findCurrent(run.id);
  if (refreshReason === "INITIAL" && current) return current;
  const content = await assembleContextPack(repositories, run);
  const fingerprint = createHash("sha256").update(stableStringify(content)).digest("hex");
  return repositories.contextPacks.create({
    id: newId(), runId: run.id, taskId: run.taskId, projectId: run.projectId, version, fingerprint, content,
    refreshedFromVersion: current?.version ?? null, refreshReason, createdById: actorId, createdAt: now,
  });
}

export async function assembleContextPack(repositories: RepositorySet, run: AgentRunEntity): Promise<AgentContextPackContent> {
  const [task, project, updates, findings, runs] = await Promise.all([
    repositories.tasks.findById(run.taskId),
    repositories.projects.findById(run.projectId),
    listAllUpdates(repositories, run.taskId),
    repositories.findings.listForTask(run.taskId),
    repositories.runs.listForTask(run.taskId),
  ]);
  if (!task) throw new NotFoundError("Task");
  if (!project) throw new NotFoundError("Project");

  updates.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const decisionUpdates = updates.filter((update) => DECISION_PATTERN.test(update.body));
  const decisionIds = new Set(decisionUpdates.map((update) => update.id));
  const routineUpdates = updates.filter((update) => !decisionIds.has(update.id));
  const recentUpdates = routineUpdates.slice(-RECENT_UPDATE_LIMIT);
  const includedUpdates = decisionUpdates.length + recentUpdates.length;
  const omittedUpdates = Math.max(0, updates.length - includedUpdates);
  const safeFindings = [...findings].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  const relevantFiles = [...new Set(safeFindings.map((finding) => safeRelativePath(finding.filePath)).filter((value): value is string => Boolean(value)))].sort();
  const content: AgentContextPackContent = {
    schemaVersion: AGENT_CONTEXT_PACK_SCHEMA_VERSION,
    task: {
      id: task.id, projectKey: project.key, number: task.number, title: redact(task.title), description: redact(task.description),
      definitionOfDone: redact(task.definitionOfDone), status: task.status, priority: task.priority, type: task.type,
      branch: task.branch ? redact(task.branch) : null, phaseId: task.phaseId,
    },
    project: {
      id: project.id, key: project.key, name: redact(project.name), repositoryUrl: safeRepositoryUrl(project.repoUrl),
      availableStatuses: [...project.availableStatuses], mergeTarget: project.mergeTarget,
    },
    dependencies: [...(task.dependencies ?? [])].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.number - b.number || a.dependsOnTaskId.localeCompare(b.dependsOnTaskId)).map((dependency) => ({
      taskId: dependency.dependsOnTaskId, projectKey: dependency.projectKey ?? "", number: dependency.number,
      title: redact(dependency.title), status: dependency.status, isBlocking: Boolean(dependency.isBlocking),
    })),
    attachments: [...(task.attachments ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map((attachment) => ({
      id: attachment.id, fileName: redact(safeFileName(attachment.fileName)), mimeType: redact(attachment.mimeType),
      size: attachment.size, downloadUrl: `/api/attachments/${encodeURIComponent(attachment.id)}/download`,
    })),
    repository: { guidanceFiles: ["AGENTS.md", "CLAUDE.md"], relevantFiles },
    history: {
      decisions: decisionUpdates.map(toSafeUpdate),
      recentUpdates: recentUpdates.map(toSafeUpdate),
      findings: safeFindings.map((finding) => ({
        id: finding.id, severity: finding.severity, title: redact(finding.title), body: redact(finding.body), disposition: finding.disposition,
        dispositionReason: finding.dispositionReason ? redact(finding.dispositionReason) : null,
        filePath: safeRelativePath(finding.filePath), lineNumber: finding.lineNumber, updatedAt: finding.updatedAt,
      })),
      priorRuns: runs.filter((candidate) => candidate.id !== run.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((candidate) => ({
        id: candidate.id, kind: candidate.kind, status: candidate.status, lastError: candidate.lastError ? redact(candidate.lastError) : null, completedAt: candidate.completedAt,
      })),
      summary: {
        totalUpdates: updates.length, includedUpdates, omittedUpdates,
        omittedSummary: omittedUpdates ? `${omittedUpdates} routine historical update${omittedUpdates === 1 ? " was" : "s were"} summarized; structured decisions and findings are retained.` : null,
      },
    },
  };
  return agentContextPackContentSchema.parse(content);
}

async function listAllUpdates(repositories: RepositorySet, taskId: string) {
  const updates: TaskUpdateEntity[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await repositories.updates.listForTask(taskId, { limit: HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    updates.push(...page.items);
    if (!page.page.hasMore) return updates;
    const nextCursor = page.page.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) throw new Error("Task update pagination did not advance while assembling context");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

function toSafeUpdate(update: { id: string; body: string; createdAt: string }) {
  return { id: update.id, body: redact(update.body), createdAt: update.createdAt };
}

function safeFileName(value: string) {
  return value.trim().split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 255) || "attachment";
}

function safeRelativePath(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /[\r\n\0]/.test(normalized)) return null;
  return redact(normalized).slice(0, 1_024);
}

function safeRepositoryUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) return null;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return redact(url.toString());
  } catch { return null; }
}

export function redact(value: string) {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/(authorization\s*:\s*bearer\s+|\b(?:token|password|secret|api[_-]?key|private[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\b(?:tfr?|sk|gh[opusr])_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .slice(0, 10_000);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
