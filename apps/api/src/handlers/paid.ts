import type { Env } from '../types/env.js';
import type { PaidResponse } from '../types/api.js';
import type { UserFlagRow } from '../types/database.js';
import { badRequest, json, methodNotAllowed, unauthorized } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';

interface PaidHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function paidHandler({ request, env, url }: PaidHandlerContext): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed();

  // JWT認証
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  // user_id は authContext から取得（クエリパラメータは廃止）
  const userId = authContext.memberId;

  const row = await env.DB
    .prepare("SELECT paid FROM user_flags WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<Pick<UserFlagRow, 'paid'>>();

  const response: PaidResponse = { ok: true, paid: row ? row.paid === 1 : false };
  return json(response);
}
