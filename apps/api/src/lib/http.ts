import type { ErrorCode } from '../types/api.js';

/**
 * JSONレスポンスを返す
 */
export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

/**
 * テキストレスポンスを返す
 */
export function text(data: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

// ============================================================================
// エラーレスポンスヘルパー（api.ts の ErrorResponse 型に準拠）
// ============================================================================

/**
 * エラーレスポンスを返す（標準形式）
 */
export function errorResponse(code: ErrorCode, message: string, status: number, details?: unknown): Response {
  const body = {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
  return json(body, status);
}

/**
 * BAD_REQUEST エラーレスポンス
 */
export function badRequest(message: string, details?: unknown): Response {
  return errorResponse('BAD_REQUEST', message, 400, details);
}

/**
 * UNAUTHORIZED エラーレスポンス（JWT認証失敗時）
 * 詳細なエラー情報を含めることができる
 */
export function unauthorized(message = 'Unauthorized', details?: unknown): Response {
  return errorResponse('UNAUTHORIZED', message, 401, details);
}

/**
 * FORBIDDEN エラーレスポンス
 */
export function forbidden(message = 'Forbidden'): Response {
  return errorResponse('FORBIDDEN', message, 403);
}

/**
 * NOT_FOUND エラーレスポンス
 */
export function notFound(message = 'Not found'): Response {
  return errorResponse('NOT_FOUND', message, 404);
}

/**
 * METHOD_NOT_ALLOWED エラーレスポンス（405用）
 */
export function methodNotAllowed(message = 'Method not allowed'): Response {
  return errorResponse('BAD_REQUEST', message, 405);
}

/**
 * RATE_LIMITED エラーレスポンス
 */
export function rateLimited(message = 'Rate limit exceeded'): Response {
  return errorResponse('RATE_LIMITED', message, 429);
}

/**
 * INTERNAL_ERROR エラーレスポンス
 */
export function internalError(message = 'Internal server error', details?: unknown): Response {
  return errorResponse('INTERNAL_ERROR', message, 500, details);
}

// ============================================================================
// レガシー互換性ヘルパー（段階的移行用）
// ============================================================================

/**
 * レガシー形式のエラーレスポンス（ok: false なし）
 * 既存コードとの互換性のため残す。新規コードでは errorResponse を使用すること。
 * @deprecated 新規コードでは errorResponse を使用してください
 */
export function legacyErrorResponse(message: string, status: number, details?: unknown): Response {
  return json({ error: message, details }, status);
}
