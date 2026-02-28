// 開発者向けのスクリプト。JWTトークンを検証するために使用されます。SupabaseのJWKセットをリモートで取得し、提供されたJWTトークンを検証します。
import { createRemoteJWKSet, jwtVerify } from 'jose';

const SUPABASE_URL = 'https://bekltsvemtvbjxwrqvxg.supabase.co';
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
const token = process.env.ACCESS_TOKEN;
if (!token) {
  console.error('ERROR: set ACCESS_TOKEN environment variable (one-line JWT).');
  process.exit(2);
}

(async () => {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });
    console.log('valid payload:', JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('invalid token:', e.message);
    process.exit(1);
  }
})();