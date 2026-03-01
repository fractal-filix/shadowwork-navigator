/// <reference types="@cloudflare/workers-types" />

export type Env = Readonly<{
  DB: D1Database;

  // Runtime environment: development | staging | production
  APP_ENV: string;

  OPENAI_API_KEY: string;
  OPENAI_API_BASE_URL?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_API_BASE_URL?: string;
  STRIPE_CHECKOUT_MODE?: string;
  PAID_ADMIN_TOKEN: string;
  
  STRIPE_PRICE_ID: string;
  CHECKOUT_SUCCESS_URL: string;
  CHECKOUT_CANCEL_URL: string;

  // JWT認証
  JWT_SIGNING_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  ACCESS_TOKEN_TTL_SECONDS: string;

  // Supabase JWT検証
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWKS_URL: string;
  SUPABASE_ISSUER: string;
  SUPABASE_AUDIENCE: string;

  // Memberstack検証
  MEMBERSTACK_SECRET_KEY: string;
  MEMBERSTACK_API_BASE_URL?: string;
  ALLOW_NON_LIVE_MEMBERSTACK_KEY?: string;
  EXTERNAL_API_TIMEOUT_MS?: string;

  // CORS
  ALLOWED_ORIGINS: string;

  // 管理者リスト（カンマ区切りのmemberId）
  ADMIN_MEMBER_IDS: string;
}>;

