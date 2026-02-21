import type { Env } from '../types/env.js';
import type { RunStartResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, createRun } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface RunStartHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function runStartHandler({ request, env, url }: RunStartHandlerContext): Promise<Response> {
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

  // 1) active run があるなら開始できない
  const active = await getActiveRun(env, user_id);
  if (active) return badRequest("active run exists");

  // 2) 過去runがあるなら「start」ではなく restart を使う
  const any = await env.DB
    .prepare(`SELECT COUNT(1) AS cnt FROM runs WHERE user_id = ?`)
    .bind(user_id)
    .first<{ cnt: number }>();

  const cnt = Number(any?.cnt ?? 0);
  if (cnt > 0) return badRequest("run already exists; use /api/run/restart");

  // 3) 初回のみ作成
  const run = await createRun(env, user_id);

  const response: RunStartResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
  };
  return json(response);
}
