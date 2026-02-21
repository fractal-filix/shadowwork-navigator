// src/handlers/threads_list.ts
import type { Env } from '../types/env.js';
import type { ThreadsListResponse } from '../types/api.js';
import type { RunRow, ThreadRow } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

async function getRunByNo(env: Env, user_id: string, run_no: number): Promise<RunRow | null> {
  return await env.DB
    .prepare(
      `SELECT id, user_id, run_no, status, created_at, updated_at
       FROM runs
       WHERE user_id = ? AND run_no = ?
       LIMIT 1`
    )
    .bind(user_id, run_no)
    .first();
}

async function getLatestRun(env: Env, user_id: string): Promise<RunRow | null> {
  const active = await getActiveRun(env, user_id);
  if (active) return active;

  return await env.DB
    .prepare(
      `SELECT id, user_id, run_no, status, created_at, updated_at
       FROM runs
       WHERE user_id = ?
       ORDER BY run_no DESC
       LIMIT 1`
    )
    .bind(user_id)
    .first();
}

interface ThreadsListHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadsListHandler({ request, env, url }: ThreadsListHandlerContext): Promise<Response> {
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

  const runNoParam = url.searchParams.get("run_no");
  const run_no = runNoParam != null && runNoParam !== "" ? Number(runNoParam) : null;

  if (run_no != null && !Number.isFinite(run_no)) {
    return badRequest('run_no must be a finite number');
  }

  let run = null;

  if (run_no != null) {
    run = await getRunByNo(env, user_id, run_no);
  } else {
    run = await getLatestRun(env, user_id);
  }

  if (!run) {
    const response: ThreadsListResponse = { ok: true, run: null, threads: [] };
    return json(response);
  }

  const rows = await env.DB
    .prepare(
    `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
     FROM threads
     WHERE run_id = ?
     ORDER BY
       step ASC,
       CASE
         WHEN step = 1 THEN question_no
         ELSE session_no
       END ASC`
    )
    .bind(run.id)
    .all<ThreadRow>();

  const threads = (rows?.results ?? []).map(formatThread).filter((t): t is ThreadRow => t !== null);

  const response: ThreadsListResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
    threads,
  };
  return json(response);
}
