import type { Env } from '../types/env.js';
import type { KmsPublicKeyResponse } from '../types/api.js';
import { json, internalError, methodNotAllowed } from '../lib/http.js';
import { kmsGetPublicKey, publicKeyBase64ToPem } from '../lib/aws_kms.js';
import { logError } from '../lib/safe_log.js';

interface KmsPublicKeyHandlerContext {
  request: Request;
  env: Env;
}

export async function kmsPublicKeyHandler({ request, env }: KmsPublicKeyHandlerContext): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed();

  const keyId = env.KMS_KEY_ID?.trim();
  if (!keyId) {
    return internalError('KMS public key not available: missing KMS_KEY_ID');
  }

  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return internalError('KMS public key not available: missing AWS credentials in environment');
  }

  const region = env.AWS_REGION?.trim() || 'ap-southeast-2';

  try {
    const result = await kmsGetPublicKey(
      {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      },
      region,
      {
        keyId,
        endpoint: env.AWS_KMS_BASE_URL?.trim() || undefined,
      }
    );

    const response: KmsPublicKeyResponse = {
      ok: true,
      kid: result.keyId || keyId,
      public_key_pem: publicKeyBase64ToPem(result.publicKeyBase64),
    };

    return json(response);
  } catch (error) {
    logError('KmsPublicKey failed', {
      keyId,
      error: String((error as Error)?.message || error),
    });
    return internalError('kms public key fetch failed');
  }
}