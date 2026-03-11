import { decryptMessageContent } from "./crypto.js";

function buildWrappedKeyCacheKey(message) {
  return [message.wrapped_key_kid, message.wrapped_key_alg, message.wrapped_key].join(":");
}

async function unsealDek({ apiBase, threadId, message, fetchFn, reason }) {
  const res = await fetchFn(`${apiBase}/api/crypto/dek/unseal`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wrapped_key: message.wrapped_key,
      wrapped_key_kid: message.wrapped_key_kid,
      wrapped_key_alg: message.wrapped_key_alg,
      thread_id: threadId,
      message_id: message.id,
      reason,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok || typeof data?.dek_base64 !== "string" || !data.dek_base64) {
    throw new Error(data?.error || "dek unseal failed");
  }

  return data.dek_base64;
}

export async function decryptThreadMessages(messages, {
  apiBase,
  threadId,
  reason = "history_view",
  fetchFn = globalThis.fetch,
  decryptMessageContentFn = decryptMessageContent,
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (!apiBase) throw new Error("apiBase is required");
  if (typeof fetchFn !== "function") throw new Error("fetchFn is required");

  const dekCache = new Map();
  const out = [];

  for (const message of messages) {
    const hasEncryptedPayload =
      typeof message?.ciphertext === "string" &&
      typeof message?.iv === "string" &&
      typeof message?.wrapped_key === "string" &&
      typeof message?.wrapped_key_alg === "string" &&
      typeof message?.wrapped_key_kid === "string" &&
      typeof message?.id === "string";

    if (!hasEncryptedPayload) {
      out.push({ ...message, content: typeof message?.content === "string" ? message.content : "" });
      continue;
    }

    const key = buildWrappedKeyCacheKey(message);
    if (!dekCache.has(key)) {
      const dek = await unsealDek({
        apiBase,
        threadId: threadId || "unknown-thread",
        message,
        fetchFn,
        reason,
      });
      dekCache.set(key, dek);
    }

    const content = await decryptMessageContentFn({
      ciphertext: message.ciphertext,
      iv: message.iv,
      rawKey: dekCache.get(key),
    });

    out.push({ ...message, content });
  }

  return out;
}
