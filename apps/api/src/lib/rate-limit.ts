export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { failures: number; windowStartedAt: number; blockedUntil: number };

export const DEFAULT_RATE_LIMIT_MAX_ENTRIES = 10_000;

/** A bounded process-local limiter; multi-worker deployments must also use the shared ingress limit in the deployment guide. */
export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private operations = 0;
  constructor(
    private readonly windowMs: number,
    private readonly maxFailures: number,
    private readonly maxBackoffMs: number,
    private readonly maxEntries = DEFAULT_RATE_LIMIT_MAX_ENTRIES,
    private readonly cleanupInterval = 64,
  ) {}

  private maintain(now: number) {
    this.operations += 1;
    if (this.operations >= this.cleanupInterval) {
      this.operations = 0;
      this.reclaimExpired(now);
    }
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    this.maintain(now);
    const entry = this.entries.get(key);
    if (!entry) return this.entries.size < this.maxEntries ? { allowed: true } : { allowed: false, retryAfterSeconds: 1 };
    if (now - entry.windowStartedAt >= this.windowMs) { this.entries.delete(key); return { allowed: true }; }
    if (entry.blockedUntil > now) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
    return entry.failures >= this.maxFailures ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)) } : { allowed: true };
  }

  failure(key: string, now = Date.now()) {
    this.maintain(now);
    const current = this.entries.get(key);
    const expired = current && now - current.windowStartedAt >= this.windowMs;
    if (!current && this.entries.size >= this.maxEntries) return;
    if (expired) this.entries.delete(key);
    const entry = !current || expired ? { failures: 0, windowStartedAt: now, blockedUntil: 0 } : current;
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      const exponent = Math.min(8, entry.failures - this.maxFailures);
      entry.blockedUntil = now + Math.min(this.maxBackoffMs, 1_000 * (2 ** exponent));
    }
    this.entries.set(key, entry);
  }

  success(key: string, now = Date.now()) { this.maintain(now); this.entries.delete(key); }

  /** Reclaim every window-expired key; also runs automatically during normal traffic. */
  reclaimExpired(now = Date.now()) {
    let reclaimed = 0;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) {
        this.entries.delete(key);
        reclaimed += 1;
      }
    }
    return reclaimed;
  }

  clear() { this.entries.clear(); }
}

export function rateLimited(reply: { code: (status: number) => { header: (name: string, value: string) => { send: (body: unknown) => unknown } } }, decision: RateLimitDecision) {
  if (decision.allowed) return false;
  reply.code(429).header("Retry-After", String(decision.retryAfterSeconds)).send({ error: "Too many requests. Try again later." });
  return true;
}
