import { createHash, randomUUID } from "node:crypto";
import type { AgentArtifactCreate, AgentArtifactMetadata } from "@taskforge/contracts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";
import type { RequestContext } from "./context.js";
import type { AgentArtifactEntity } from "./models.js";
import type { RepositorySet, UnitOfWork } from "./repositories.js";

export const MAX_AGENT_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const MAX_AGENT_ARTIFACTS_PER_RUN = 100;
const textMedia = /^(text\/|application\/(json|xml|yaml|x-yaml)|image\/svg\+xml)/i;
const secret = /(authorization\s*:\s*bearer\s+|["']?\b(?:token|password|secret|api[_-]?key)["']?\s*[=:]\s*["']?)([^\s,;"'}]+)/gi;
const token = /\b(?:tfr?|sk|whsec)_[A-Za-z0-9_-]+\b/g;

export function redactArtifactText(value: string) { return value.replace(secret, "$1[REDACTED]").replace(token, "[REDACTED]"); }
function redactMetadata(value: unknown): unknown {
  if (typeof value === "string") return redactArtifactText(value);
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactMetadata(item)]));
  return value;
}
function decode(input: AgentArtifactCreate) {
  const dataUrl = input.data.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (dataUrl && dataUrl[1]?.toLowerCase() !== input.mediaType.toLowerCase()) throw new ValidationError("Artifact data URL media type does not match mediaType");
  const encoded = (dataUrl?.[2] ?? input.data).replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new ValidationError("Artifact data must be valid base64");
  const original = Buffer.from(encoded, "base64");
  if (!original.length || original.length > MAX_AGENT_ARTIFACT_BYTES) throw new ValidationError("Agent artifacts must be between 1 byte and 5 MB");
  const payloadHash = createHash("sha256").update(original).digest("hex");
  if (input.payloadSha256 && input.payloadSha256.toLowerCase() !== payloadHash) throw new ValidationError("Artifact payload checksum does not match its content");
  return textMedia.test(input.mediaType) ? Buffer.from(redactArtifactText(original.toString("utf8")), "utf8") : original;
}
function validateMedia(input: AgentArtifactCreate) {
  const mediaType = input.mediaType.toLowerCase();
  if (input.type === "SCREENSHOT" && !["image/png", "image/jpeg", "image/webp"].includes(mediaType)) throw new ValidationError("Screenshot artifacts must be PNG, JPEG, or WebP images");
  if (input.type !== "SCREENSHOT" && !textMedia.test(mediaType)) throw new ValidationError("Structured agent artifacts must use a supported text or JSON media type");
  if (input.type === "COMMIT" && input.metadata.sha.toLowerCase() !== input.headSha.toLowerCase()) throw new ValidationError("Commit artifact SHA must match headSha");
}

export class AgentArtifactApplicationService {
  constructor(private readonly unitOfWork: UnitOfWork, private readonly now = () => new Date().toISOString(), private readonly newId = randomUUID) {}

  async create(context: RequestContext, runId: string, input: AgentArtifactCreate) {
    return this.unitOfWork.run(async (repositories) => {
      const run = await repositories.runs.findById(runId); if (!run) throw new NotFoundError("Agent run");
      const task = await repositories.tasks.findById(run.taskId); if (!task) throw new NotFoundError("Task");
      const project = await this.authorize(repositories, context, run.projectId);
      const currentAgent = context.actor.kind === "AGENT" && run.status === "RUNNING" && run.controlState === "ACTIVE" && run.leaseOwner === context.actor.userId;
      const operator = context.actor.kind === "HUMAN" && (context.actor.role === "ADMIN" || context.actor.userId === project.ownerId);
      if (!currentAgent && !operator) throw new ForbiddenError("Only the current run lease owner, project owner, or administrator can record run artifacts");
      if (currentAgent && context.actor.tokenScopes && !context.actor.tokenScopes.includes("task:artifact")) throw new ForbiddenError("The agent credential cannot record run artifacts");
      validateMedia(input);
      const content = decode(input);
      const contentHash = createHash("sha256").update(content).digest("hex");
      await repositories.artifacts.lockRun(runId);
      const duplicate = await repositories.artifacts.findDuplicate(runId, input.type, input.headSha, contentHash);
      if (duplicate) return { artifact: duplicate, created: false };
      if (await repositories.artifacts.countForRun(runId) >= MAX_AGENT_ARTIFACTS_PER_RUN) throw new ValidationError(`Agent runs retain at most ${MAX_AGENT_ARTIFACTS_PER_RUN} artifacts`);
      const artifact: AgentArtifactEntity = { id: this.newId(), runId, taskId: task.id, projectId: task.projectId, headSha: input.headSha.toLowerCase(), type: input.type, name: redactArtifactText(input.name), mediaType: input.mediaType.toLowerCase(), size: content.length, contentHash, metadata: redactMetadata(input.metadata) as AgentArtifactMetadata, content, createdById: context.actor.userId, createdAt: this.now() };
      const saved = await repositories.artifacts.create(artifact);
      const created = saved.id === artifact.id;
      if (created) await repositories.activity.record({ projectId: task.projectId, taskId: task.id, actorId: context.actor.userId, action: "agent_artifact.recorded", metadata: { artifactId: saved.id, runId, headSha: saved.headSha, type: saved.type, contentHash: saved.contentHash, size: saved.size } });
      return { artifact: saved, created };
    });
  }

  async listForRun(context: RequestContext, runId: string) { return this.unitOfWork.run(async (repositories) => { const run = await repositories.runs.findById(runId); if (!run) throw new NotFoundError("Agent run"); await this.authorize(repositories, context, run.projectId); return repositories.artifacts.listForRun(runId); }); }
  async listForTask(context: RequestContext, taskId: string, headSha?: string) { return this.unitOfWork.run(async (repositories) => { const task = await repositories.tasks.findById(taskId); if (!task) throw new NotFoundError("Task"); await this.authorize(repositories, context, task.projectId); return repositories.artifacts.listForTask(taskId, headSha); }); }
  async get(context: RequestContext, artifactId: string) { return this.unitOfWork.run(async (repositories) => { const artifact = await repositories.artifacts.findById(artifactId); if (!artifact) throw new NotFoundError("Agent artifact"); await this.authorize(repositories, context, artifact.projectId); return artifact; }); }

  private async authorize(repositories: RepositorySet, context: RequestContext, projectId: string) { const project = await repositories.projects.findById(projectId); if (!project) throw new NotFoundError("Project"); if (context.actor.role !== "ADMIN" && !(await repositories.memberships.isMember(projectId, context.actor.userId))) throw new ForbiddenError("You are not a member of this project"); return project; }
}
