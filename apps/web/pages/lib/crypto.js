const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function getCryptoApi() {
  const c = globalThis.crypto;
  if (!c?.subtle || typeof c.getRandomValues !== "function") {
    throw new Error("Web Crypto API is not available");
  }
  return c;
}

function toBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

async function importAesKey(rawKey) {
  const c = getCryptoApi();
  return c.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptMessageContent(content) {
  const c = getCryptoApi();
  const rawKey = c.getRandomValues(new Uint8Array(32));
  const iv = c.getRandomValues(new Uint8Array(12));

  const key = await importAesKey(rawKey);
  const ciphertext = await c.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    TEXT_ENCODER.encode(content)
  );

  return {
    alg: "AES-GCM-256",
    v: 1,
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    rawKey: toBase64(rawKey),
  };
}

export async function decryptMessageContent({ ciphertext, iv, rawKey }) {
  const c = getCryptoApi();
  const key = await importAesKey(fromBase64(rawKey));

  const plainBuffer = await c.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext)
  );

  return TEXT_DECODER.decode(plainBuffer);
}
