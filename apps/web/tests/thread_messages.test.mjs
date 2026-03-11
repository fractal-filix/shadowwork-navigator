import test from "node:test";
import assert from "node:assert/strict";

import { decryptThreadMessages } from "../pages/lib/thread_messages.js";

test("decryptThreadMessages: wrapped keyごとにDEKを1回だけunsealして復号する", async () => {
  const unsealCalls = [];
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    unsealCalls.push(body);
    return {
      ok: true,
      async json() {
        return { ok: true, dek_base64: "shared-raw-key" };
      },
    };
  };

  const decryptCalls = [];
  const decryptMessageContentFn = async ({ ciphertext, iv, rawKey }) => {
    decryptCalls.push({ ciphertext, iv, rawKey });
    return `plain:${ciphertext}:${iv}:${rawKey}`;
  };

  const messages = [
    {
      id: "m1",
      role: "user",
      ciphertext: "ct1",
      iv: "iv1",
      wrapped_key: "wk-shared",
      wrapped_key_alg: "RSAES_OAEP_SHA_256",
      wrapped_key_kid: "kid-1",
    },
    {
      id: "m2",
      role: "assistant",
      ciphertext: "ct2",
      iv: "iv2",
      wrapped_key: "wk-shared",
      wrapped_key_alg: "RSAES_OAEP_SHA_256",
      wrapped_key_kid: "kid-1",
    },
  ];

  const result = await decryptThreadMessages(messages, {
    apiBase: "https://api.shadowwork-navigator.com",
    threadId: "thread-1",
    fetchFn,
    decryptMessageContentFn,
  });

  assert.equal(unsealCalls.length, 1);
  assert.equal(decryptCalls.length, 2);
  assert.equal(result[0].content, "plain:ct1:iv1:shared-raw-key");
  assert.equal(result[1].content, "plain:ct2:iv2:shared-raw-key");
});

test("decryptThreadMessages: 暗号メタがない既存メッセージはcontentをそのまま使う", async () => {
  const result = await decryptThreadMessages(
    [
      {
        id: "legacy-1",
        role: "user",
        content: "既存平文",
      },
    ],
    {
      apiBase: "https://api.shadowwork-navigator.com",
      fetchFn: async () => {
        throw new Error("fetch should not be called");
      },
    }
  );

  assert.equal(result[0].content, "既存平文");
});
