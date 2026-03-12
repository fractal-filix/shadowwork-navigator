const WRAPPED_KEY_ALG = "RSAES_OAEP_SHA_256";

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

function pemToSpkiBytes(publicKeyPem) {
  const stripped = String(publicKeyPem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");

  if (!stripped) {
    throw new Error("public key PEM is empty");
  }

  return fromBase64(stripped);
}

export async function wrapRawKeyWithPublicKey({ rawKeyBase64, publicKeyPem }) {
  if (typeof rawKeyBase64 !== "string" || !rawKeyBase64) {
    throw new Error("rawKeyBase64 is required");
  }
  if (typeof publicKeyPem !== "string" || !publicKeyPem) {
    throw new Error("publicKeyPem is required");
  }

  const c = getCryptoApi();
  const spki = pemToSpkiBytes(publicKeyPem);
  const key = await c.subtle.importKey(
    "spki",
    spki,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );

  const wrapped = await c.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    fromBase64(rawKeyBase64)
  );

  return {
    wrapped_key: toBase64(new Uint8Array(wrapped)),
    wrapped_key_alg: WRAPPED_KEY_ALG,
  };
}

export async function fetchKmsPublicKey({ apiBase, fetchFn = globalThis.fetch } = {}) {
  if (!apiBase) throw new Error("apiBase is required");
  if (typeof fetchFn !== "function") throw new Error("fetchFn is required");

  const res = await fetchFn(`${apiBase}/api/crypto/kms_public_key`, {
    method: "GET",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "kms_public_key failed");
  }
  if (typeof data?.kid !== "string" || !data.kid) {
    throw new Error("kms_public_key response missing kid");
  }
  if (typeof data?.public_key_pem !== "string" || !data.public_key_pem) {
    throw new Error("kms_public_key response missing public_key_pem");
  }

  return {
    kid: data.kid,
    publicKeyPem: data.public_key_pem,
  };
}
