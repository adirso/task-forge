import { redact } from "./security.js";

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  async request(path: string, init: RequestInit = {}, attempts = 3): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
        const text = await response.text();
        if (!response.ok) throw new Error(`TaskForge API returned HTTP ${response.status}: ${redact(text).slice(0, 300)}`);
        return text ? JSON.parse(text) as Record<string, unknown> : {};
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await this.sleep(250 * (2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("TaskForge API request failed");
  }
}
