import type { Env } from '../types/env.js';
import type { AuthExchangeResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, internalError, unauthorized, errorResponse } from '../lib/http.js';
import { createJWT, createSetCookieHeader } from '../lib/jwt.js';
import { logError } from '../lib/safe_log.js';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

interface AuthExchangeContext {
  request: Request;
  env: Env;
}

interface AuthExchangeRequest {
  token?: unknown;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getRemoteJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(jwksUrl);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, jwks);
  return jwks;
}

function extractSubject(payload: Record<string, unknown>): string | null {
  const sub = payload.sub;
  if (typeof sub !== 'string') return null;

  const trimmed = sub.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Supabase Access Token を検証し、内部用JWTを発行して Cookie で返す
 * 
 * POST /api/auth/exchange
 * Request: { "token": "supabase-access-token" }
 * Response: { "ok": true, "member_id": "<supabase-sub>", "token_type": "Bearer", "expires_in": 900 }
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
  if (!env.SUPABASE_JWKS_URL) missing.push('SUPABASE_JWKS_URL');
  if (!env.SUPABASE_ISSUER) missing.push('SUPABASE_ISSUER');
  if (!env.SUPABASE_AUDIENCE) missing.push('SUPABASE_AUDIENCE');

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

  // Supabase JWT (access token) を検証
  let memberId: string;
  try {
    const jwks = getRemoteJwks(env.SUPABASE_JWKS_URL.trim());
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.SUPABASE_ISSUER,
      audience: env.SUPABASE_AUDIENCE,
    });
    const extractedMemberId = extractSubject(payload as Record<string, unknown>);

    // sub クレームを user id として扱う
    if (!extractedMemberId) {
      return unauthorized('invalid supabase token payload');
    }

    memberId = extractedMemberId;
  } catch (err) {
    if (
      err instanceof joseErrors.JWTInvalid ||
      err instanceof joseErrors.JWTClaimValidationFailed ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWSInvalid
    ) {
      return unauthorized('supabase token verification failed');
    }

    logError('supabase jwt verify error');
    return errorResponse('INTERNAL_ERROR', 'supabase jwt verify error', 502, {
      message: '[REDACTED]',
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
    logError('jwt creation error');
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
