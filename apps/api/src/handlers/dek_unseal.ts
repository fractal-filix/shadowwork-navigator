import type { Env } from '../types/env.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden, internalError } from '../lib/http.js';
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface DekUnsealRequestBody {
  wrapped_key?: unknown;
  wrapped_key_kid?: unknown;
  wrapped_key_alg?: unknown;
  thread_id?: unknown;
  message_id?: unknown;
  reason?: unknown;
}

export async function dekUnsealHandler({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed();

  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) return unauthorized('Invalid or missing JWT');

  const user_id = authContext.memberId;

  const isPaid = await getUserPaidFlag(env, user_id);
  if (!isPaid) return forbidden('Paid access required');

  let body: DekUnsealRequestBody = {};
  try {
    body = await request.json() as DekUnsealRequestBody;
  } catch {
    return badRequest('invalid json');
  }

  const wrappedKey = typeof body.wrapped_key === 'string' ? body.wrapped_key.trim() : '';
  const kid = typeof body.wrapped_key_kid === 'string' ? body.wrapped_key_kid.trim() : '';
  const alg = typeof body.wrapped_key_alg === 'string' ? body.wrapped_key_alg.trim() : '';
  const thread_id = typeof body.thread_id === 'string' ? body.thread_id.trim() : '';
  const message_id = typeof body.message_id === 'string' ? body.message_id.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!wrappedKey) return badRequest('wrapped_key is required');
  if (!kid) return badRequest('wrapped_key_kid is required');
  if (!alg) return badRequest('wrapped_key_alg is required');
  if (!thread_id) return badRequest('thread_id is required');
  if (!message_id) return badRequest('message_id is required');

  // ここで監査ログを記録（まずは Cloudflare Workers のログ）
  console.info('DekUnseal requested', {
    user_id,
    thread_id,
    message_id,
    kid,
    alg,
    reason: reason ? '[REDACTED]' : undefined,
  });

  // 環境変数に AWS 資格情報があるか確認
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    // 実運用ではここで AssumeRole→KMS Decrypt を行う。現状は環境未設定のため実行不可。
    return internalError('Decrypt not available: missing AWS credentials in environment');
  }

  // TODO: 実装 — sts:AssumeRole -> KMS Decrypt の実行 (SigV4署名付きリクエスト)
  // セキュリティ上の注意: 平文DEK/平文本文をログや永続化に保存しないこと

  return json({ ok: true, message: 'decrypt endpoint accepted (not yet implemented on this worker)' }, 202);
}
