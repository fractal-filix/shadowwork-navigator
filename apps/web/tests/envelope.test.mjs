import test from "node:test";
import assert from "node:assert/strict";

import { wrapRawKeyWithPublicKey } from "../pages/lib/envelope.js";

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function toPem(spkiBytes) {
  const body = Buffer.from(spkiBytes).toString("base64");
  const lines = body.match(/.{1,64}/g) || [];
  return ["-----BEGIN PUBLIC KEY-----", ...lines, "-----END PUBLIC KEY-----"].join("\n");
}

test("wrapRawKeyWithPublicKey: RSA-OAEP(SHA-256)でraw keyをラップできる", async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = toPem(new Uint8Array(spki));

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const rawKeyBase64 = toBase64(rawKey);

  const wrapped = await wrapRawKeyWithPublicKey({
    rawKeyBase64,
    publicKeyPem,
  });

  assert.equal(wrapped.wrapped_key_alg, "RSAES_OAEP_SHA_256");
  assert.equal(typeof wrapped.wrapped_key, "string");
  assert.ok(wrapped.wrapped_key.length > 0);

  const unwrapped = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    keyPair.privateKey,
    base64ToBytes(wrapped.wrapped_key)
  );

  assert.equal(toBase64(new Uint8Array(unwrapped)), rawKeyBase64);
});
