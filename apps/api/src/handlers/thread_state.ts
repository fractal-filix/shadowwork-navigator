// src/handlers/thread_state.ts
import type { Env } from '../types/env.js';
import type { ThreadStateResponse, EncryptedMessageDetail } from '../types/api.js';
import type { RunRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, getActiveThread, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

async function getLatestRun(env: Env, user_id: string): Promise<RunRow | null> {
  // active 優先
  const active = await getActiveRun(env, user_id);
  if (active) return active;

  // なければ最新の completed（run_no 最大）
  return await env.DB
    .prepare(
      `SELECT id, user_id, run_no, status, created_at, updated_at
       FROM runs
       WHERE user_id = ? AND status = 'completed'
       ORDER BY run_no DESC
       LIMIT 1`
    )
    .bind(user_id)
    .first();
}

interface ThreadStateHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadStateHandler({ request, env, url }: ThreadStateHandlerContext): Promise<Response> {
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

  const run = await getLatestRun(env, user_id);
  if (!run) {
    const response: ThreadStateResponse = {
      ok: true,
      run: null,
      thread: null,
      last_message: null,
    };
    return json(response);
  }

  // completed run の場合：thread は返さない（restart で再開）
  if (run.status === "completed") {
    const response: ThreadStateResponse = {
      ok: true,
      run: { id: run.id, run_no: run.run_no, status: run.status },
      thread: null,
      last_message: null,
    };
    return json(response);
  }

  const thread = await getActiveThread(env, run.id);
  if (!thread) {
    const response: ThreadStateResponse = {
      ok: true,
      run: { id: run.id, run_no: run.run_no, status: run.status },
      thread: null,
      last_message: null,
    };
    return json(response);
  }

  const lastMessage = await env.DB
    .prepare(
      `SELECT
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
       WHERE thread_id = ?
       ORDER BY seq DESC
       LIMIT 1`
    )
    .bind(thread.id)
    .first<Pick<EncryptedMessageDetail, 'role' | 'client_message_id' | 'ciphertext' | 'iv' | 'alg' | 'v' | 'kid' | 'seq' | 'created_at'>>();

  const response: ThreadStateResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
    thread: formatThread(thread),
    last_message: lastMessage ? {
      role: lastMessage.role,
      client_message_id: lastMessage.client_message_id,
      ciphertext: lastMessage.ciphertext,
      iv: lastMessage.iv,
      alg: lastMessage.alg,
      v: lastMessage.v,
      kid: lastMessage.kid,
      seq: lastMessage.seq,
      created_at: lastMessage.created_at,
    } : null,
  };
  return json(response);
}
