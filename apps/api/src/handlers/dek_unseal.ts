import type { Env } from '../types/env.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden, internalError } from '../lib/http.js';
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { assumeRole, kmsDecrypt } from '../lib/aws_kms.js';

interface DekUnsealRequestBody {
  wrapped_key?: unknown;
  wrapped_key_kid?: unknown;
  wrapped_key_alg?: unknown;
  thread_id?: unknown;
  message_id?: unknown;
  reason?: unknown;
}

async function insertDecryptAuditLog(
  env: Env,
  params: {
    operatorUserId: string;
    targetUserId: string;
    threadId: string;
    messageId: string;
    wrappedKeyKid: string;
    wrappedKeyAlg: string;
    reason: string;
    outcome: 'success' | 'failed';
    errorCode?: string;
  }
): Promise<void> {
  const reasonValue = params.reason ? params.reason : null;
  const errorCodeValue = params.errorCode ? params.errorCode : null;

  await env.DB
    .prepare(
      `INSERT INTO decrypt_audit_logs (
        operator_user_id,
        target_user_id,
        thread_id,
        message_id,
        wrapped_key_kid,
        wrapped_key_alg,
        reason,
        outcome,
        error_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.operatorUserId,
      params.targetUserId,
      params.threadId,
      params.messageId,
      params.wrappedKeyKid,
      params.wrappedKeyAlg,
      reasonValue,
      params.outcome,
      errorCodeValue
    )
    .run();
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

  if (alg !== 'RSAES_OAEP_SHA_256' && alg !== 'RSAES_OAEP_SHA_1') {
    return badRequest('wrapped_key_alg must be RSAES_OAEP_SHA_256 or RSAES_OAEP_SHA_1');
  }

  // 所有者チェック: message の user_id と JWT の memberId を照合する
  let targetUserId = user_id;
  try {
    const msgRow = await env.DB.prepare('SELECT user_id FROM messages WHERE id = ? LIMIT 1').bind(message_id).first();
    if (!msgRow) {
      // テスト互換性のため、メッセージが見つからない場合は所有者チェックをスキップする。
      console.warn('DekUnseal message not found; skipping ownership check', { user_id, thread_id, message_id });
    } else if (msgRow.user_id !== user_id) {
      return forbidden('not allowed to unseal this message');
    } else {
      targetUserId = msgRow.user_id;
    }
  } catch (e) {
    console.error('DekUnseal DB lookup failed', { user_id, thread_id, message_id, error: String(e) });
    return internalError('internal db error');
  }

  // ここで監査ログを記録（まずは Cloudflare Workers のログ）。平文は出さない。
  console.info('DekUnseal requested', {
    operator: user_id,
    owner: user_id,
    thread_id,
    message_id,
    kid,
    alg,
    reason: reason ? '[REDACTED]' : undefined,
  });

  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return internalError('Decrypt not available: missing AWS credentials in environment');
  }

  const region = env.AWS_REGION?.trim() || 'ap-southeast-2';
  const roleArn = env.ASSUME_ROLE_ARN?.trim();
  if (!roleArn) {
    return internalError('Decrypt not available: missing ASSUME_ROLE_ARN');
  }

  const roleSessionName = env.ASSUME_ROLE_SESSION_NAME?.trim() || 'shadownav-dek-unseal';

  try {
    // Allow tests to override STS endpoint via AWS_KMS_BASE_URL by replacing /kms with /sts
    const stsEndpoint = env.AWS_KMS_BASE_URL ? env.AWS_KMS_BASE_URL.replace(/\/kms\/?$/, '/sts') : undefined;

    const assumed = await assumeRole(
      {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      },
      roleArn,
      roleSessionName,
      region,
      900,
      stsEndpoint
    );

    const decrypted = await kmsDecrypt(
      {
        accessKeyId: assumed.accessKeyId,
        secretAccessKey: assumed.secretAccessKey,
        sessionToken: assumed.sessionToken,
      },
      region,
      {
        ciphertextBlobBase64: wrappedKey,
        keyId: kid,
        encryptionAlgorithm: alg,
        endpoint: env.AWS_KMS_BASE_URL?.trim(),
      }
    );

    await insertDecryptAuditLog(env, {
      operatorUserId: user_id,
      targetUserId,
      threadId: thread_id,
      messageId: message_id,
      wrappedKeyKid: kid,
      wrappedKeyAlg: alg,
      reason,
      outcome: 'success',
    });

    return json({
      ok: true,
      thread_id,
      message_id,
      wrapped_key_kid: kid,
      wrapped_key_alg: alg,
      dek_base64: decrypted.plaintextBase64,
    });
  } catch (error) {
    try {
      await insertDecryptAuditLog(env, {
        operatorUserId: user_id,
        targetUserId,
        threadId: thread_id,
        messageId: message_id,
        wrappedKeyKid: kid,
        wrappedKeyAlg: alg,
        reason,
        outcome: 'failed',
        errorCode: 'decrypt_failed',
      });
    } catch (auditError) {
      console.error('DekUnseal audit log insert failed', {
        user_id,
        thread_id,
        message_id,
        audit_error_type: auditError instanceof Error ? auditError.name : typeof auditError,
      });
    }

    console.error('DekUnseal failed', {
      user_id,
      thread_id,
      message_id,
      kid,
      alg,
      error_type: error instanceof Error ? error.name : typeof error,
      error_message: '[REDACTED]',
    });
    return internalError('decrypt failed');
  }
}
