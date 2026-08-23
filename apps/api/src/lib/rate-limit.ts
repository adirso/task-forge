export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { failures: number; windowStartedAt: number; blockedUntil: number };

/** Small bounded in-process limiter. Deployments with multiple API workers should put a shared limiter in front. */
export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly windowMs: number, private readonly maxFailures: number, private readonly maxBackoffMs: number) {}

  check(key: string, now = Date.now()): RateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };
    if (now - entry.windowStartedAt >= this.windowMs) { this.entries.delete(key); return { allowed: true }; }
    if (entry.blockedUntil > now) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
    return entry.failures >= this.maxFailures ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)) } : { allowed: true };
  }

  failure(key: string, now = Date.now()) {
    const current = this.entries.get(key);
    const entry = !current || now - current.windowStartedAt >= this.windowMs ? { failures: 0, windowStartedAt: now, blockedUntil: 0 } : current;
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      const exponent = Math.min(8, entry.failures - this.maxFailures);
      entry.blockedUntil = now + Math.min(this.maxBackoffMs, 1_000 * (2 ** exponent));
    }
    this.entries.set(key, entry);
  }

  success(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}

export function rateLimited(reply: { code: (status: number) => { header: (name: string, value: string) => { send: (body: unknown) => unknown } } }, decision: RateLimitDecision) {
  if (decision.allowed) return false;
  reply.code(429).header("Retry-After", String(decision.retryAfterSeconds)).send({ error: "Too many requests. Try again later." });
  return true;
}
