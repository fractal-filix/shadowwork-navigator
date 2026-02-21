// src/handlers/runs_list.ts
import type { Env } from '../types/env.js';
import type { RunsListResponse, RunDetail } from '../types/api.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface RunsListHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function runsListHandler({ request, env, url }: RunsListHandlerContext): Promise<Response> {
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

  const rows = await env.DB
    .prepare(
      `SELECT id, run_no, status, created_at, updated_at
       FROM runs
       WHERE user_id = ?
       ORDER BY run_no DESC`
    )
    .bind(user_id)
    .all<RunDetail>();

  const response: RunsListResponse = { ok: true, runs: rows?.results ?? [] };
  return json(response);
}
