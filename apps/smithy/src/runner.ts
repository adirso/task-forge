import type { ProviderConfig, ProviderLabel } from "./config.js";
import { ApiClient } from "./api.js";
import { executeCommand } from "./command.js";
import { redact, verifySignature } from "./security.js";

export interface AgentEvent { id: string; event: string; task?: { id: string; title?: string; description?: string; definitionOfDone?: string; projectKey?: string; status?: string }; runId?: string | null; }
export type RunnerResult = { status: number; body: string };

export class SmithyRunner {
  private readonly seen = new Map<string, number>();
  constructor(private readonly providers: Partial<Record<ProviderLabel, ProviderConfig>>, private readonly apiFactory: (config: ProviderConfig) => ApiClient = (config) => new ApiClient(process.env.TASKFORGE_API_URL ?? "http://127.0.0.1:4000", config.apiToken), private readonly execute = executeCommand, private readonly now = () => Date.now()) {}

  async handle(provider: string, headers: Record<string, string | undefined>, body: string): Promise<RunnerResult> {
    const config = this.providers[provider as ProviderLabel];
    if (!config) return { status: 404, body: JSON.stringify({ error: "Unknown or unconfigured agent" }) };
    if (!verifySignature(config.webhookSecret, headers["x-taskforge-signature"], body, Math.floor(this.now() / 1000))) return { status: 401, body: JSON.stringify({ error: "Invalid signature" }) };
    let event: AgentEvent;
    try { event = JSON.parse(body) as AgentEvent; } catch { return { status: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }
    if (!event.id || !event.task?.id) return { status: 400, body: JSON.stringify({ error: "Event task and id are required" }) };
    const previous = this.seen.get(event.id);
    if (previous && this.now() - previous < 24 * 60 * 60_000) return { status: 202, body: JSON.stringify({ accepted: true, duplicate: true }) };
    this.seen.set(event.id, this.now());
    if (this.seen.size > 1000) for (const [id, timestamp] of this.seen) if (this.now() - timestamp > 24 * 60 * 60_000) this.seen.delete(id);
    void this.process(config, event).catch(() => undefined);
    return { status: 202, body: JSON.stringify({ accepted: true, eventId: event.id }) };
  }

  private async process(config: ProviderConfig, event: AgentEvent) {
    const api = this.apiFactory(config);
    let runId = event.runId ?? null;
    try {
      if (!runId) {
        const created = await api.request(`/api/tasks/${event.task!.id}/runs`, { method: "POST", body: JSON.stringify({ kind: event.event.includes("review") ? "REVIEW" : "IMPLEMENTATION" }) });
        runId = String((created.run as { id: string }).id);
      }
      await api.request(`/api/runs/${runId}/claim`, { method: "POST", body: JSON.stringify({}) });
      const prompt = [`TaskForge task ${event.task!.projectKey ?? ""} ${event.task!.id}: ${event.task!.title ?? ""}`, event.task!.description ?? "", `Definition of done: ${event.task!.definitionOfDone ?? ""}`, "Report progress through the TaskForge API. Do not merge changes yourself."].join("\n\n");
      const result = await this.execute(config.cmd, prompt, config.repo);
      if (result.code !== 0) throw new Error(redact(result.error?.message ?? (result.stderr || `Provider exited with code ${result.code}`)));
      await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "SUCCEEDED" }) });
    } catch (error) {
      if (runId) await api.request(`/api/runs/${runId}/complete`, { method: "POST", body: JSON.stringify({ status: "FAILED", error: redact(error instanceof Error ? error.message : "Runner failure") }) }).catch(() => undefined);
    }
  }
}
