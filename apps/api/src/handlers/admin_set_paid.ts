// src/handlers/admin_set_paid.ts
import type { Env } from '../types/env.js';
import type { AdminSetPaidResponse } from '../types/api.js';
import { errorResponse, json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toPaid01(v: unknown, fallback: 0 | 1 = 1): 0 | 1 {
  if (v === 0 || v === "0" || v === false || v === "false") return 0;
  if (v === 1 || v === "1" || v === true || v === "true") return 1;
  return fallback;
}

interface AdminSetPaidHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function adminSetPaidHandler({ request, env, url }: AdminSetPaidHandlerContext): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  // JWT認証必須
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  // 管理者チェック
  const adminMemberIds = env.ADMIN_MEMBER_IDS.split(',').map(id => id.trim());
  if (!adminMemberIds.includes(authContext.memberId)) {
    return forbidden('Admin access required');
  }

  // 追加の管理トークン必須（強めに保護）
  const adminToken = request.headers.get('X-PAID-ADMIN-TOKEN') || '';
  if (!adminToken) {
    return forbidden('Admin token required');
  }
  if (!env.PAID_ADMIN_TOKEN) {
    // misconfiguration: token is required for admin operations
    return errorResponse('INTERNAL_ERROR', 'PAID_ADMIN_TOKEN is not set', 500);
  }
  if (adminToken !== env.PAID_ADMIN_TOKEN) {
    return forbidden('Invalid admin token');
  }

  // リクエストボディから対象user_idを取得
  const body = await readJsonBody(request);
  const user_id = body?.user_id as string | undefined;
  if (!user_id) return badRequest("user_id required");

  const paid = toPaid01(body?.paid, 1);

  await env.DB
    .prepare(
      `INSERT INTO user_flags (user_id, paid, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         paid = excluded.paid,
         updated_at = datetime('now')`
    )
    .bind(user_id, paid)
    .run();

  const response: AdminSetPaidResponse = { ok: true, user_id, paid };
  return json(response);
}
