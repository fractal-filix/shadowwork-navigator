/**
 * JWT 検証・発行ユーティリティ
 * 
 * HS256（HMAC-SHA256）を使用して JWT を生成・検証する
 * Cloudflare Workers環境で動作することを前提とする
 */

interface JWTPayload {
  sub: string;  // memberId
  iss: string;  // issuer
  aud: string;  // audience
  exp: number;  // expiration time
  iat: number;  // issued at
}

interface JWTHeader {
  alg: string;
  typ: string;
}

/**
 * JWT生成（HS256）
 */
export async function createJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt_payload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header: JWTHeader = {
    alg: 'HS256',
    typ: 'JWT',
  };

  // Header.Payload.Signature
  function base64UrlEncode(input: string): string {
    if (typeof btoa === 'function') {
      return btoa(input).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  const headerStr = base64UrlEncode(JSON.stringify(header));
  const payloadStr = base64UrlEncode(JSON.stringify(jwt_payload));
  const message = `${headerStr}.${payloadStr}`;

  // HMAC-SHA256で署名
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signatureBytes = new Uint8Array(signature);
  // base64url エンコード
  const signatureStr = (typeof btoa === 'function'
    ? btoa(String.fromCharCode(...signatureBytes))
    : Buffer.from(signatureBytes).toString('base64'))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${message}.${signatureStr}`;
}

/**
 * JWT検証（HS256）
 * 
 * 返り値: 検証成功時はpayload、失敗時はnull
 */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    function padBase64(input: string): string {
      const mod = input.length % 4;
      if (mod === 2) return `${input}==`;
      if (mod === 3) return `${input}=`;
      if (mod === 1) return `${input}===`;
      return input;
    }

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerStr, payloadStr, signatureStr] = parts;

    // 署名検証
    const message = `${headerStr}.${payloadStr}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Base64url decode (compat for Node & Worker)
    function base64UrlToBuffer(s: string): Uint8Array {
      const base64 = padBase64(s.replace(/-/g, '+').replace(/_/g, '/'));
      if (typeof atob === 'function') {
        const binary = atob(base64);
        return Uint8Array.from(binary, c => c.charCodeAt(0));
      }
      // Buffer handles padding automatically
      return Buffer.from(base64, 'base64');
    }

    const signatureBuffer = base64UrlToBuffer(signatureStr);

    let isValid = false;
    try {
      isValid = await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBuffer,
        new TextEncoder().encode(message)
      );
    } catch (e) {
      isValid = false;
    }

    if (!isValid) {
      // Fallback: compute expected signature and byte-compare (quietly)
      try {
        const signKey = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const expectedSigBuffer = await crypto.subtle.sign('HMAC', signKey, new TextEncoder().encode(message));
        const expectedBytes = new Uint8Array(expectedSigBuffer);

        const actualBytes = new Uint8Array(signatureBuffer);
        const same = expectedBytes.length === actualBytes.length && expectedBytes.every((b, i) => b === actualBytes[i]);
        if (same) {
          isValid = true;
        }
      } catch (_e) {
        // ignore
      }
    }

    if (!isValid) {
      return null;
    }

    // Payloadをdecode
    let payloadJson: string;
    const payloadBase64 = padBase64(payloadStr.replace(/-/g, '+').replace(/_/g, '/'));
    if (typeof atob === 'function') {
      payloadJson = atob(payloadBase64);
    } else {
      payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    }
    const payload = JSON.parse(payloadJson) as JWTPayload;

    // 有効期限チェック
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Cookieに JWT をセットするヘッダを生成
 */
export function createSetCookieHeader(
  token: string,
  maxAgeSeconds: number
): string {
  return `access_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * リクエストから Cookie の JWT を抽出
 */
export function extractJWTFromCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  // access_token=<JWT> を抽出
  const match = cookieHeader.match(/access_token=([^;]+)/);
  return match ? match[1] : null;
}
