// src/handlers/thread_start.ts
import type { Env } from '../types/env.js';
import type { ThreadStartResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, getActiveThread, createNextThread, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface ThreadStartHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadStartHandler({ request, env, url }: ThreadStartHandlerContext): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

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

  // 1) active run を取得
  const run = await getActiveRun(env, user_id);
  if (!run) return badRequest("no active run; call /api/run/start (or /api/run/restart)");

  // 2) active thread があればそれを返す
  const activeThread = await getActiveThread(env, run.id);
  if (activeThread) {
    const response: ThreadStartResponse = {
      ok: true,
      run: { id: run.id, run_no: run.run_no, status: run.status },
      thread: formatThread(activeThread),
    };
    return json(response);
  }

  // 3) なければ「次のthread」を作る（Step1 Q1..5 → Step2 Session 1..30）
  let nextThread = null;
  try {
    nextThread = await createNextThread(env, run);
  } catch (e) {
    return badRequest(String((e as Error)?.message || e));
  }

  if (!nextThread) {
    // 30セッション到達等で run が completed になった
    return badRequest('run completed (no more threads can be created)', {
      run: { id: run.id, run_no: run.run_no, status: 'completed' },
      thread: null,
    });
  }

  const response: ThreadStartResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
    thread: formatThread(nextThread),
  };
  return json(response);
}
