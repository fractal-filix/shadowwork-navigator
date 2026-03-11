import test from "node:test";
import assert from "node:assert/strict";

import { decryptMessageContent, encryptMessageContent } from "../pages/lib/crypto.js";

test("encrypt/decrypt: AES-GCMで平文が往復できる", async () => {
  const source = "秘密のメッセージ";
  const encrypted = await encryptMessageContent(source);

  assert.equal(encrypted.alg, "AES-GCM-256");
  assert.equal(encrypted.v, 1);
  assert.equal(typeof encrypted.ciphertext, "string");
  assert.equal(typeof encrypted.iv, "string");
  assert.ok(encrypted.ciphertext.length > 0);
  assert.ok(encrypted.iv.length > 0);

  const plain = await decryptMessageContent({
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    rawKey: encrypted.rawKey,
  });

  assert.equal(plain, source);
});

test("encrypt: 同じ平文でも毎回異なる暗号文になる", async () => {
  const source = "repeat";
  const a = await encryptMessageContent(source);
  const b = await encryptMessageContent(source);

  assert.notEqual(a.ciphertext, b.ciphertext);
});
