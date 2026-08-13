import crypto from "node:crypto";

function encryptionKey(material: string) {
  return crypto.createHash("sha256").update(material).digest();
}

/** AES-256-GCM payload: base64url(iv || authTag || ciphertext). */
export function encryptSecret(plaintext: string, keyMaterial: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(payload: string, keyMaterial: string) {
  const buffer = Buffer.from(payload, "base64url");
  if (buffer.length < 29) throw new Error("Invalid ciphertext");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const data = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(keyMaterial), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
