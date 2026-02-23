import type { Env } from '../types/env.js';
import type { RunStep2MetaCardResponse } from '../types/api.js';
import type { RunRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from '../lib/http.js';
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { getActiveRun } from '../lib/run.js';

const MAX_KID_LENGTH = 128;

function uuid(): string {
  return crypto.randomUUID();
}

interface RunStep2MetaCardHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

interface CardRow {
  content: string;
  content_iv: string;
  content_alg: string;
  content_v: number;
  content_kid: string | null;
}

export async function runStep2MetaCardHandler({ request, env, url }: RunStep2MetaCardHandlerContext): Promise<Response> {
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

  const run = await getActiveRun(env, userId);
  if (!run) return badRequest('no active run; call /api/run/start (or /api/run/restart)');

  if (request.method === 'GET') {
    const card = await env.DB
      .prepare(
        `SELECT content, content_iv, content_alg, content_v, content_kid
         FROM cards
         WHERE run_id = ? AND user_id = ? AND kind = 'step2_meta_card'
         LIMIT 1`
      )
      .bind(run.id, userId)
      .first<CardRow>();

    if (!card) return badRequest('step2_meta_card not found');

    const response: RunStep2MetaCardResponse = {
      ok: true,
      run: { id: run.id, run_no: run.run_no, status: run.status },
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

  const ciphertext = body.ciphertext;
  const iv = body.iv;
  const alg = body.alg;
  const version = body.v;
  const kid = body.kid;

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

  const existing = await env.DB
    .prepare(
      `SELECT id
       FROM cards
       WHERE run_id = ? AND user_id = ? AND kind = 'step2_meta_card'
       LIMIT 1`
    )
    .bind(run.id, userId)
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
          (?, ?, NULL, ?, 'step2_meta_card', ?, ?, ?, ?, ?)`
      )
      .bind(
        uuid(),
        run.id,
        userId,
        ciphertext.trim(),
        iv.trim(),
        alg.trim(),
        Number(version),
        typeof kid === 'string' ? kid.trim() : null,
      )
      .run();
  }

  const response: RunStep2MetaCardResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
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
