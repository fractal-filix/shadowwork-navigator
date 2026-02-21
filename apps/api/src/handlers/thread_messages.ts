// src/handlers/thread_messages.ts
import type { Env } from '../types/env.js';
import type { ThreadMessagesResponse, EncryptedMessageDetail } from '../types/api.js';
import type { ThreadRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface ClampOptions {
  min: number;
  max: number;
  fallback: number;
}

function clampInt(v: string | null, { min, max, fallback }: ClampOptions): number {
  // url.SearchParams.get() は未指定だと null を返す
  // Number(null) === 0 なので、そのままだと未指定が 1 に丸められる（min=1）
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

interface ThreadMetaRow extends ThreadRow {
  run_no: number;
  run_status: string;
}

interface ThreadMessagesHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadMessagesHandler({ request, env, url }: ThreadMessagesHandlerContext): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed();

  // JWT認証
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const user_id = authContext.memberId;

  const isPaid = await getUserPaidFlag(env, user_id);
  if (!isPaid) {
    return forbidden('Paid access required');
  }
  const thread_id = url.searchParams.get("thread_id");
  const limit = clampInt(url.searchParams.get("limit"), { min: 1, max: 2000, fallback: 500 });

  if (!thread_id) return badRequest("thread_id required");

  const meta = await env.DB
    .prepare(
      `SELECT
         t.id, t.run_id, t.user_id, t.step, t.question_no, t.session_no, t.status, t.created_at, t.updated_at,
         r.run_no AS run_no, r.status AS run_status
       FROM threads t
       JOIN runs r ON r.id = t.run_id
       WHERE t.id = ? AND t.user_id = ?
       LIMIT 1`
    )
    .bind(thread_id, user_id)
    .first<ThreadMetaRow>();

  if (!meta) return badRequest("thread not found");

  const msgs = await env.DB
    .prepare(
      `SELECT
         id,
         role,
         client_message_id,
         content AS ciphertext,
         content_iv AS iv,
         content_alg AS alg,
         content_v AS v,
         content_kid AS kid,
         seq,
         created_at
       FROM messages
       WHERE thread_id = ? AND run_id = ? AND user_id = ?
       ORDER BY seq ASC
       LIMIT ?`
    )
    .bind(thread_id, meta.run_id, meta.user_id, limit)
    .all<EncryptedMessageDetail>();

  const response: ThreadMessagesResponse = {
    ok: true,
    run: { id: meta.run_id, run_no: meta.run_no, status: meta.run_status as 'active' | 'completed' },
    thread: formatThread(meta)!,
    messages: msgs?.results ?? [],
    page: { limit }, // 将来cursor追加するときに拡張しやすい
  };
  return json(response);
}
