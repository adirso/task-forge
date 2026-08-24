import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function sign(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(secret: string, header: string | undefined, body: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) return false;
  const match = /^t=(\d+),v1=([0-9a-f]+)$/i.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(sign(secret, timestamp, body), "hex");
  const supplied = Buffer.from(match[2]!, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function redact(value: string) {
  return value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token|secret|password|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/tf_[A-Za-z0-9_-]+/g, "tf_[REDACTED]");
}
