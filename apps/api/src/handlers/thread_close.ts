// src/handlers/thread_close.ts
import type { Env } from '../types/env.js';
import type { ThreadCloseResponse } from '../types/api.js';
import type { RunRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, closeActiveThread, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface ThreadCloseHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadCloseHandler({ request, env, url }: ThreadCloseHandlerContext): Promise<Response> {
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

  const run = await getActiveRun(env, user_id);
  if (!run) return badRequest("no active run; call /api/run/start (or /api/run/restart)");

  const closed = await closeActiveThread(env, run.id);
  if (!closed) return badRequest("no active thread");

  // close によって run.status が変わる可能性があるので再取得して返す
  const runRow = await env.DB
    .prepare(`SELECT id, run_no, status FROM runs WHERE id = ? LIMIT 1`)
    .bind(run.id)
    .first<Pick<RunRow, 'id' | 'run_no' | 'status'>>();

  const response: ThreadCloseResponse = {
    ok: true,
    run: runRow
      ? { id: runRow.id, run_no: runRow.run_no, status: runRow.status }
      : { id: run.id, run_no: run.run_no, status: run.status },
    thread: formatThread(closed)!,
  };
  return json(response);
}
