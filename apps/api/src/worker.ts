import type { Env } from './types/env.js';
import { createRouter } from "./routes.js";
import { errorResponse } from "./lib/http.js";

import { healthHandler } from "./handlers/health.js";
import { authExchangeHandler } from "./handlers/auth_exchange.js";
import { paidHandler } from "./handlers/paid.js";
import { checkoutSessionCreateHandler } from "./handlers/checkout_session_create.js";
import { adminSetPaidHandler } from "./handlers/admin_set_paid.js";
import { threadStartHandler } from "./handlers/thread_start.js";
import { threadChatHandler } from "./handlers/thread_chat.js";
import { threadMessageHandler } from "./handlers/thread_message.js";
import { threadStateHandler } from "./handlers/thread_state.js";
import { threadCloseHandler } from "./handlers/thread_close.js";
import { runStartHandler } from "./handlers/run_start.js";
import { runRestartHandler } from "./handlers/run_restart.js";
import { runsListHandler } from "./handlers/runs_list.js";
import { threadsListHandler } from "./handlers/threads_list.js";
import { threadMessagesHandler } from "./handlers/thread_messages.js";

import { llmPingHandler } from "./handlers/llm_ping.js";
import { llmRespondHandler } from "./handlers/llm_respond.js";

import { stripeWebhookHandler } from "./handlers/stripe_webhook.js";

const router = createRouter();

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

function isAllowedOrigin(origin: string, env: Env): boolean {
  return getAllowedOrigins(env).includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {

  // CORS Allowlist（環境変数から取得）
  // 本番: https://shadowwork-navigator.com のみ
  // 開発: preview URLは原則許可しない（例外は1件だけ環境変数で指定）
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true", // Cookie送受信を許可
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function withCors(res: Response, cors: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

// routes
router.on("GET", "/", healthHandler);
router.on("POST", "/api/auth/exchange", authExchangeHandler);
router.on("GET", "/api/paid", paidHandler);
router.on("POST", "/api/checkout/session", checkoutSessionCreateHandler);
router.on("POST", "/api/admin/set_paid", adminSetPaidHandler);
router.on("POST", "/api/thread/start", threadStartHandler);
router.on("POST", "/api/thread/chat", threadChatHandler);
router.on("POST", "/api/thread/message", threadMessageHandler);
router.on("GET", "/api/thread/state", threadStateHandler);
router.on("POST", "/api/thread/close", threadCloseHandler);
router.on("POST", "/api/run/start", runStartHandler);
router.on("POST", "/api/run/restart", runRestartHandler);
router.on("GET", "/api/runs/list", runsListHandler);
router.on("GET", "/api/threads/list", threadsListHandler);
router.on("GET", "/api/thread/messages", threadMessagesHandler);

// llm routes
router.on("POST", "/api/llm/ping", llmPingHandler);
router.on("POST", "/api/llm/respond", llmRespondHandler);

// stripe webhook
router.on("POST", "/api/stripe/webhook", stripeWebhookHandler);

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (env.APP_ENV === "production" && !env.MEMBERSTACK_SECRET_KEY.startsWith("sk_live_")) {
      return errorResponse('INTERNAL_ERROR', 'misconfigured memberstack secret key', 500);
    }

    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(origin, env)) {
      return errorResponse('FORBIDDEN', 'origin not allowed', 403);
    }

    const ch = origin ? corsHeaders(origin) : {};
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ch });
    }

    let res: Response;
    try {
      res = await router.handle(request, env, ctx);
    } catch {
      res = errorResponse('INTERNAL_ERROR', 'internal error', 500);
    }

    return withCors(res, ch);
  },
};

export default worker;
