import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret } from "../src/lib/token-crypto.js";

test("token secrets round-trip through AES-GCM encryption", () => {
  const secret = "tf_abc12_super-secret-value";
  const ciphertext = encryptSecret(secret, "test-key-material");
  assert.notEqual(ciphertext, secret);
  assert.equal(decryptSecret(ciphertext, "test-key-material"), secret);
  assert.notEqual(encryptSecret(secret, "test-key-material"), ciphertext);
});

test("token decryption rejects the wrong key", () => {
  const ciphertext = encryptSecret("tf_abc12_value", "correct-key");
  assert.throws(() => decryptSecret(ciphertext, "wrong-key"));
});
