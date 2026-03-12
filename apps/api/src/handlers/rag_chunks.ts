import type { Env } from '../types/env.js';
import type { RagChunkUpsertResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from '../lib/http.js';
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

const MAX_ID_LENGTH = 128;
const MAX_CHUNKS = 64;
const MAX_CHUNK_TEXT_LENGTH = 2000;

type RagChunkInput = {
  chunk_no: unknown;
  text: unknown;
};

interface RagChunksHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function ragChunksUpsertHandler({ request, env, url }: RagChunksHandlerContext): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();

  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const userId = authContext.memberId;
  const isPaid = await getUserPaidFlag(env, userId);
  if (!isPaid) {
    return forbidden('Paid access required');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const threadId = normalizeOptionalString(body.thread_id);
  if (!threadId) {
    return badRequest('thread_id is required');
  }
  if (threadId.length > MAX_ID_LENGTH) {
    return badRequest(`thread_id must be <= ${MAX_ID_LENGTH} chars`);
  }

  const messageId = normalizeOptionalString(body.message_id);
  const clientMessageId = normalizeOptionalString(body.client_message_id);
  if (!messageId && !clientMessageId) {
    return badRequest('message_id or client_message_id is required');
  }
  if (messageId && messageId.length > MAX_ID_LENGTH) {
    return badRequest(`message_id must be <= ${MAX_ID_LENGTH} chars`);
  }
  if (clientMessageId && clientMessageId.length > MAX_ID_LENGTH) {
    return badRequest(`client_message_id must be <= ${MAX_ID_LENGTH} chars`);
  }

  const chunks = body.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return badRequest('chunks must be a non-empty array');
  }
  if (chunks.length > MAX_CHUNKS) {
    return badRequest(`chunks must contain at most ${MAX_CHUNKS} items`);
  }

  const normalizedChunks: Array<{ chunk_no: number; text: string }> = [];
  const chunkNoSet = new Set<number>();

  for (const rawChunk of chunks as RagChunkInput[]) {
    const chunkNo = rawChunk?.chunk_no;
    const text = rawChunk?.text;

    if (!Number.isInteger(chunkNo) || Number(chunkNo) < 0) {
      return badRequest('chunk_no must be an integer >= 0');
    }
    if (chunkNoSet.has(Number(chunkNo))) {
      return badRequest('chunk_no must be unique within chunks');
    }
    chunkNoSet.add(Number(chunkNo));

    if (typeof text !== 'string' || !text.trim()) {
      return badRequest('text is required for each chunk');
    }

    const normalizedText = text.trim();
    if (normalizedText.length > MAX_CHUNK_TEXT_LENGTH) {
      return badRequest(`chunk text must be <= ${MAX_CHUNK_TEXT_LENGTH} chars`);
    }

    normalizedChunks.push({ chunk_no: Number(chunkNo), text: normalizedText });
  }

  const threadRow = await env.DB
    .prepare('SELECT id FROM threads WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(threadId, userId)
    .first<{ id: string }>();

  if (!threadRow?.id) {
    return badRequest('thread not found');
  }

  let targetMessageId = messageId;
  if (!targetMessageId) {
    const messageRowByClientId = await env.DB
      .prepare('SELECT id FROM messages WHERE thread_id = ? AND user_id = ? AND client_message_id = ? LIMIT 1')
      .bind(threadId, userId, clientMessageId)
      .first<{ id: string }>();

    if (!messageRowByClientId?.id) {
      return badRequest('message not found');
    }
    targetMessageId = messageRowByClientId.id;
  } else {
    const messageRowById = await env.DB
      .prepare('SELECT id FROM messages WHERE id = ? AND thread_id = ? AND user_id = ? LIMIT 1')
      .bind(targetMessageId, threadId, userId)
      .first<{ id: string }>();

    if (!messageRowById?.id) {
      return badRequest('message not found');
    }
  }

  const response: RagChunkUpsertResponse = {
    ok: true,
    thread_id: threadId,
    message_id: targetMessageId,
    chunk_count: normalizedChunks.length,
    status: 'accepted',
  };

  // 8.1 では API 契約と入力検証を先行し、embedding 生成/Qdrant upsert は 8.2 で実装する。
  return json(response);
}
