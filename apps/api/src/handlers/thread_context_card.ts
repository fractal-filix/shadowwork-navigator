import type { Env } from '../types/env.js';
import type { ThreadContextCardResponse } from '../types/api.js';
import type { ThreadRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from '../lib/http.js';
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { formatThread } from '../lib/run.js';

const MAX_KID_LENGTH = 128;

function uuid(): string {
  return crypto.randomUUID();
}

interface ThreadContextCardHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

interface ThreadMetaRow extends ThreadRow {
  run_no: number;
  run_status: 'active' | 'completed';
}

interface CardRow {
  content: string;
  content_iv: string;
  content_alg: string;
  content_v: number;
  content_kid: string | null;
}

async function getThreadMeta(env: Env, threadId: string, userId: string): Promise<ThreadMetaRow | null> {
  return await env.DB
    .prepare(
      `SELECT
         t.id, t.run_id, t.user_id, t.step, t.question_no, t.session_no, t.status, t.created_at, t.updated_at,
         r.run_no AS run_no, r.status AS run_status
       FROM threads t
       JOIN runs r ON r.id = t.run_id
       WHERE t.id = ? AND t.user_id = ?
       LIMIT 1`
    )
    .bind(threadId, userId)
    .first<ThreadMetaRow>();
}

export async function threadContextCardHandler({ request, env, url }: ThreadContextCardHandlerContext): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'GET') return methodNotAllowed();

  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const userId = authContext.memberId;

  const isPaid = await getUserPaidFlag(env, userId);
  if (!isPaid) {
    return forbidden('Paid access required');
  }

  if (request.method === 'GET') {
    const threadId = url.searchParams.get('thread_id');
    if (!threadId || !threadId.trim()) return badRequest('thread_id required');

    const thread = await getThreadMeta(env, threadId.trim(), userId);
    if (!thread) return badRequest('thread not found');

    const card = await env.DB
      .prepare(
        `SELECT content, content_iv, content_alg, content_v, content_kid
         FROM cards
         WHERE thread_id = ? AND user_id = ? AND kind = 'context_card'
         LIMIT 1`
      )
      .bind(thread.id, userId)
      .first<CardRow>();

    if (!card) return badRequest('context_card not found');

    const response: ThreadContextCardResponse = {
      ok: true,
      run: { id: thread.run_id, run_no: thread.run_no, status: thread.run_status },
      thread: formatThread(thread)!,
      card: {
        ciphertext: card.content,
        iv: card.content_iv,
        alg: card.content_alg,
        v: card.content_v,
        kid: card.content_kid,
      },
    };
    return json(response);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const threadId = body.thread_id;
  const ciphertext = body.ciphertext;
  const iv = body.iv;
  const alg = body.alg;
  const version = body.v;
  const kid = body.kid;

  if (typeof threadId !== 'string' || !threadId.trim()) {
    return badRequest('thread_id is required');
  }
  if (typeof ciphertext !== 'string' || !ciphertext.trim()) {
    return badRequest('ciphertext is required');
  }
  if (typeof iv !== 'string' || !iv.trim()) {
    return badRequest('iv is required');
  }
  if (typeof alg !== 'string' || !alg.trim()) {
    return badRequest('alg is required');
  }
  if (!Number.isInteger(version) || Number(version) <= 0) {
    return badRequest('v must be a positive integer');
  }
  if (typeof kid !== 'undefined' && kid !== null && typeof kid !== 'string') {
    return badRequest('kid must be string when provided');
  }
  if (typeof kid === 'string' && kid.trim().length > MAX_KID_LENGTH) {
    return badRequest(`kid must be <= ${MAX_KID_LENGTH} chars`);
  }

  const thread = await getThreadMeta(env, threadId.trim(), userId);
  if (!thread) return badRequest('thread not found');

  const existing = await env.DB
    .prepare(
      `SELECT id
       FROM cards
       WHERE thread_id = ? AND user_id = ? AND kind = 'context_card'
       LIMIT 1`
    )
    .bind(thread.id, userId)
    .first<{ id: string }>();

  if (existing?.id) {
    await env.DB
      .prepare(
        `UPDATE cards
         SET content = ?, content_iv = ?, content_alg = ?, content_v = ?, content_kid = ?, updated_at = DATETIME('now')
         WHERE id = ?`
      )
      .bind(ciphertext.trim(), iv.trim(), alg.trim(), Number(version), typeof kid === 'string' ? kid.trim() : null, existing.id)
      .run();
  } else {
    await env.DB
      .prepare(
        `INSERT INTO cards
          (id, run_id, thread_id, user_id, kind, content, content_iv, content_alg, content_v, content_kid)
         VALUES
          (?, ?, ?, ?, 'context_card', ?, ?, ?, ?, ?)`
      )
      .bind(
        uuid(),
        thread.run_id,
        thread.id,
        userId,
        ciphertext.trim(),
        iv.trim(),
        alg.trim(),
        Number(version),
        typeof kid === 'string' ? kid.trim() : null,
      )
      .run();
  }

  const response: ThreadContextCardResponse = {
    ok: true,
    run: { id: thread.run_id, run_no: thread.run_no, status: thread.run_status },
    thread: formatThread(thread)!,
    card: {
      ciphertext: ciphertext.trim(),
      iv: iv.trim(),
      alg: alg.trim(),
      v: Number(version),
      kid: typeof kid === 'string' ? kid.trim() : null,
    },
  };

  return json(response);
}
