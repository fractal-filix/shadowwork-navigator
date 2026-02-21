import type { Env } from '../types/env.js';
import type { AuthExchangeResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, internalError, unauthorized, errorResponse } from '../lib/http.js';
import { createJWT, createSetCookieHeader } from '../lib/jwt.js';
import { fetchExternalApi } from '../lib/external_api.js';

interface AuthExchangeContext {
  request: Request;
  env: Env;
}

interface AuthExchangeRequest {
  token?: unknown;
}

interface MemberstackVerifyResponse {
  id: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Memberstack トークンを検証し、JWT を発行して Cookie で返す
 * 
 * Memberstack Admin REST API (https://admin.memberstack.com/members/verify-token) を使用して
 * フロントエンドから渡された Memberstack JWT を検証し、バックエンド用の JWT を発行します。
 * 
 * POST /api/auth/exchange
 * Request: { "token": "memberstack-jwt-token" }
 * Response: { "ok": true, "member_id": "mem_xxx", "token_type": "Bearer", "expires_in": 900 }
 * Set-Cookie: access_token=<JWT>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
 */
export async function authExchangeHandler({ request, env }: AuthExchangeContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  // 環境変数の確認
  const missing: string[] = [];
  if (!env.JWT_SIGNING_SECRET) missing.push('JWT_SIGNING_SECRET');
  if (!env.JWT_ISSUER) missing.push('JWT_ISSUER');
  if (!env.JWT_AUDIENCE) missing.push('JWT_AUDIENCE');
  if (!env.ACCESS_TOKEN_TTL_SECONDS) missing.push('ACCESS_TOKEN_TTL_SECONDS');
  if (!env.MEMBERSTACK_SECRET_KEY) missing.push('MEMBERSTACK_SECRET_KEY');

  if (missing.length) {
    return internalError('missing env vars', { missing });
  }

  // リクエストボディを取得
  let body: AuthExchangeRequest;
  try {
    body = await request.json() as AuthExchangeRequest;
  } catch {
    return badRequest('invalid json');
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return badRequest('token required');
  }

  // Memberstack Admin API でトークンを検証
  let memberId: string;
  try {
    const memberstackBase = (env.MEMBERSTACK_API_BASE_URL || 'https://admin.memberstack.com').trim();
    const verifyResponse = await fetchExternalApi(`${memberstackBase}/members/verify-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': env.MEMBERSTACK_SECRET_KEY,
      },
      body: JSON.stringify({ token }),
    }, env);

    if (!verifyResponse.ok) {
      return unauthorized('memberstack verification failed');
    }

    const verifyData = await verifyResponse.json() as MemberstackVerifyResponse;

    // 検証成功確認（Member オブジェクトに id が含まれている）
    if (!verifyData.id) {
      return unauthorized('invalid memberstack response');
    }

    memberId = String(verifyData.id);
  } catch (err) {
    console.error('memberstack verify error:', err);
    return errorResponse('INTERNAL_ERROR', 'memberstack api error', 502, {
      message: String((err as Error)?.message || err),
    });
  }

  // JWT を生成
  const ttlSeconds = parseInt(env.ACCESS_TOKEN_TTL_SECONDS, 10);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return internalError('invalid ACCESS_TOKEN_TTL_SECONDS');
  }

  let jwtToken: string;
  try {
    jwtToken = await createJWT(
      {
        sub: memberId,
        iss: env.JWT_ISSUER,
        aud: env.JWT_AUDIENCE,
      },
      env.JWT_SIGNING_SECRET,
      ttlSeconds
    );
  } catch (err) {
    console.error('jwt creation error:', err);
    return internalError('jwt creation failed');
  }

  // レスポンスを作成
  const response: AuthExchangeResponse = {
    ok: true,
    member_id: memberId,
    token_type: 'Bearer',
    expires_in: ttlSeconds,
  };

  // Set-Cookie ヘッダを設定
  const setCookieHeader = createSetCookieHeader(jwtToken, ttlSeconds);

  return json(response, 200, {
    'Set-Cookie': setCookieHeader,
  });
}
