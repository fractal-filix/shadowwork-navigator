/**
 * JWT認証ミドルウェア
 * 
 * リクエストから Cookie の JWT を抽出・検証し、
 * payload（memberId）をリクエストコンテキストに追加する
 */

import { verifyJWT, extractJWTFromCookie } from './jwt.js';

export interface AuthContext {
  memberId: string;
}

/**
 * リクエストから JWT を抽出・検証する
 * 
 * 成功時: AuthContext（memberId付き）を返す
 * 失敗時: null を返す（呼び出し側で401を返す）
 */
export async function authenticateRequest(
  request: Request,
  jwtSecret: string,
  env?: { APP_ENV?: string; JWT_ISSUER?: string; JWT_AUDIENCE?: string }
): Promise<AuthContext | null> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;

  const token = bearerToken || extractJWTFromCookie(request);
  if (!token) {
    console.debug('authenticateRequest: no token in Cookie');
    return null;
  }

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload) {
    return null;
  }

  // iss / aud チェック
  if (env?.JWT_ISSUER && payload.iss !== env.JWT_ISSUER) return null;
  if (env?.JWT_AUDIENCE && payload.aud !== env.JWT_AUDIENCE) return null;

  return {
    memberId: payload.sub,
  };
}

/**
 * 認証が必須でないエンドポイント一覧（パス）
 * これらのエンドポイントはauthenticateRequestを呼ぶ必要がない
 */
export const unauthenticatedPaths = new Set([
  '/',                          // GET /: ヘルスチェック
  '/api/auth/exchange',         // POST /api/auth/exchange: JWT発行
  '/api/stripe/webhook',        // POST /api/stripe/webhook: Webhook（署名検証で保護）
]);

/**
 * 指定パスが認証不要かチェック
 */
export function isUnauthenticatedPath(pathname: string): boolean {
  return unauthenticatedPaths.has(pathname);
}
