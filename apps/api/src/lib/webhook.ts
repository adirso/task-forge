import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { UnitOfWork } from "../application/repositories.js";
import type { WebhookDeliveryEntity } from "../application/models.js";

export const WEBHOOK_MAX_ATTEMPTS = 5;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_RETRY_BASE_MS = 1_000;
export const WEBHOOK_RETRY_MAX_MS = 5 * 60_000;

export function createWebhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhookPayload(secret: string, timestamp: number, payload: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

export function verifyWebhookSignature(secret: string, timestamp: number, payload: string, signature: string) {
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, payload), "hex");
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

type DeliveryLogger = {
  info?: (details: Record<string, unknown>, message: string) => void;
  warn?: (details: Record<string, unknown>, message: string) => void;
};

type DispatcherOptions = {
  request?: WebhookRequest;
  resolveAddresses?: (hostname: string) => Promise<LookupAddress[]>;
  now?: () => Date;
  decryptSecret: (ciphertext: string) => string;
  logger?: DeliveryLogger;
  maxAttempts?: number;
  timeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  leaseMs?: number;
  batchSize?: number;
  pollIntervalMs?: number;
};

export interface WebhookDestination {
  url: URL;
  addresses: LookupAddress[];
}

export interface WebhookRequestOptions {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type WebhookRequest = (destination: WebhookDestination, options: WebhookRequestOptions) => Promise<{ status: number }>;
export type WebhookAddressResolver = (hostname: string) => Promise<LookupAddress[]>;

const isPublicAddress = (address: string) => {
  try { return ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
};

/** Resolve once, reject the entire answer set if any answer is non-public, and retain it for the request. */
export async function resolveWebhookDestination(value: string, resolveAddresses: WebhookAddressResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true })) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Webhook destination is not allowed"); }
  if (!(url.protocol === "http:" || url.protocol === "https:") || url.username || url.password) throw new Error("Webhook destination is not allowed");

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: LookupAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  } else {
    try { addresses = await resolveAddresses(hostname); }
    catch { throw new Error("Webhook destination could not be resolved"); }
  }
  if (!addresses.length || addresses.some(({ address, family }) => !isIP(address) || isIP(address) !== family || !isPublicAddress(address))) {
    throw new Error("Webhook destination is not allowed");
  }
  return { url, addresses };
}

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options: LookupOptions, callback) => {
    if ("all" in options && options.all) {
      callback(null, addresses);
      return;
    }
    const selected = addresses.find((address) => !options.family || address.family === options.family) ?? addresses[0]!;
    callback(null, selected.address, selected.family);
  };
}

/** Make exactly one HTTP request to a previously validated address. Node's HTTP client does not follow redirects. */
export const requestWebhook: WebhookRequest = (destination, options) => new Promise((resolve, reject) => {
  const transport = destination.url.protocol === "https:" ? https : http;
  const request = transport.request(destination.url, {
    method: options.method,
    headers: options.headers,
    signal: options.signal,
    lookup: pinnedLookup(destination.addresses),
  }, (response) => {
    // Discard response bytes; neither response bodies nor secret request headers are exposed to callers or logs.
    response.resume();
    resolve({ status: response.statusCode ?? 0 });
  });
  request.on("error", reject);
  request.end(options.body);
});

export class WebhookDispatcher {
  private readonly request: WebhookRequest;
  private readonly resolveAddresses: (hostname: string) => Promise<LookupAddress[]>;
  private readonly now: () => Date;
  private readonly logger: DeliveryLogger;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;

  constructor(private readonly unitOfWork: UnitOfWork, private readonly decryptSecret: (ciphertext: string) => string, options: Omit<DispatcherOptions, "decryptSecret"> = {}) {
    this.request = options.request ?? requestWebhook;
    this.resolveAddresses = options.resolveAddresses ?? ((hostname) => dnsLookup(hostname, { all: true, verbatim: true }));
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? {};
    this.maxAttempts = options.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    this.retryBaseMs = options.retryBaseMs ?? WEBHOOK_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? WEBHOOK_RETRY_MAX_MS;
    this.leaseMs = options.leaseMs ?? Math.max(this.timeoutMs * 2, 30_000);
    this.batchSize = options.batchSize ?? 20;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  wake() { void this.tick(); }

  tick(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.runBatch().finally(() => { this.running = null; });
    return this.running;
  }

  private async runBatch() {
    let delivered = 0;
    for (let index = 0; index < this.batchSize; index += 1) {
      const delivery = await this.claimNext();
      if (!delivery) break;
      if (await this.deliver(delivery)) delivered += 1;
    }
    return delivered;
  }

  private async claimNext() {
    const now = this.now();
    const nowIso = now.toISOString();
    const lockedUntil = new Date(now.getTime() + this.leaseMs).toISOString();
    return this.unitOfWork.run(async (repositories) => {
      const candidates = await repositories.webhookDeliveries.listDue(nowIso, this.batchSize);
      for (const id of candidates) {
        if (!(await repositories.webhookDeliveries.claim(id, nowIso, lockedUntil))) continue;
        return repositories.webhookDeliveries.findById(id);
      }
      return null;
    });
  }

  private async deliver(delivery: WebhookDeliveryEntity) {
    const configuration = await this.unitOfWork.run((repositories) => repositories.users.getWebhookConfiguration(delivery.agentId));
    if (!configuration?.webhookUrl) return this.fail(delivery, "Webhook URL is not configured", null);
    if (!configuration.secretCiphertext) return this.fail(delivery, "Webhook signing secret is not configured", null);

    let destination: WebhookDestination;
    try {
      destination = await resolveWebhookDestination(configuration.webhookUrl, this.resolveAddresses);
    } catch (error) {
      const reason = error instanceof Error && error.message === "Webhook destination could not be resolved"
        ? error.message
        : "Webhook destination is not allowed";
      return this.fail(delivery, reason, null);
    }

    let secret: string;
    try {
      secret = this.decryptSecret(configuration.secretCiphertext);
    } catch {
      return this.fail(delivery, "Webhook signing secret could not be decrypted", null);
    }

    const signatureTimestamp = Math.floor(this.now().getTime() / 1_000);
    const signature = signWebhookPayload(secret, signatureTimestamp, delivery.payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.request(destination, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": delivery.id,
          "X-TaskForge-Event-Id": delivery.id,
          "X-TaskForge-Delivery-Attempt": String(delivery.attemptCount),
          "X-TaskForge-Secret-Version": String(configuration.secretVersion),
          "X-TaskForge-Signature": `t=${signatureTimestamp},v1=${signature}`,
        },
        body: delivery.payload,
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 300) {
        const deliveredAt = this.now().toISOString();
        await this.unitOfWork.run((repositories) => repositories.webhookDeliveries.markDelivered(delivery.id, deliveredAt, response.status));
        this.logger.info?.({ deliveryId: delivery.id, eventType: delivery.eventType, agentId: delivery.agentId, attempt: delivery.attemptCount, httpStatus: response.status }, "Webhook delivered");
        return true;
      }
      return this.fail(delivery, `HTTP ${response.status}`, response.status);
    } catch (error) {
      return this.fail(delivery, error instanceof DOMException && error.name === "AbortError" ? "Delivery timed out" : "Network request failed", null);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fail(delivery: WebhookDeliveryEntity, reason: string, httpStatus: number | null) {
    const now = this.now();
    const terminal = delivery.attemptCount >= this.maxAttempts;
    await this.unitOfWork.run(async (repositories) => {
      if (terminal) return repositories.webhookDeliveries.markFailed(delivery.id, now.toISOString(), reason, httpStatus);
      const delay = Math.min(this.retryBaseMs * (2 ** Math.max(0, delivery.attemptCount - 1)), this.retryMaxMs);
      return repositories.webhookDeliveries.markRetry(delivery.id, new Date(now.getTime() + delay).toISOString(), reason, httpStatus, now.toISOString());
    });
    this.logger.warn?.({ deliveryId: delivery.id, eventType: delivery.eventType, agentId: delivery.agentId, attempt: delivery.attemptCount, terminal, httpStatus, reason }, "Webhook delivery failed");
    return false;
  }
}
