import type { Env } from '../types/env.js';
import type { CheckoutSessionCreateResponse } from '../types/api.js';
import { badRequest, errorResponse, json, unauthorized } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';
import { fetchExternalApi } from '../lib/external_api.js';

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface CheckoutSessionCreateContext {
  request: Request;
  env: Env;
}

export async function checkoutSessionCreateHandler({ request, env }: CheckoutSessionCreateContext): Promise<Response> {
  // JWT認証
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  // memberId は authContext から取得
  const memberId = authContext.memberId;

  // 必要な env
  // - STRIPE_SECRET_KEY: sk_...
  // - STRIPE_PRICE_ID: price_...（Stripeで作ったPrice ID）
  // - CHECKOUT_SUCCESS_URL: 購入成功時に戻すURL（{CHECKOUT_SESSION_ID}を含められる）
  // - CHECKOUT_CANCEL_URL: キャンセル時に戻すURL
  const missing: string[] = [];
  if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_PRICE_ID) missing.push("STRIPE_PRICE_ID");
  if (!env.CHECKOUT_SUCCESS_URL) missing.push("CHECKOUT_SUCCESS_URL");
  if (!env.CHECKOUT_CANCEL_URL) missing.push("CHECKOUT_CANCEL_URL");
  if (missing.length) {
    return errorResponse('INTERNAL_ERROR', 'missing env', 500, { missing });
  }

  // Memberstack形式の検証（念のため）
  if (!/^mem_[a-zA-Z0-9_]+$/.test(memberId)) {
    return badRequest("invalid member_id format");
  }

  const mode = (env.STRIPE_CHECKOUT_MODE || "payment").trim();
  if (!['payment', 'subscription'].includes(mode)) {
    return errorResponse('INTERNAL_ERROR', 'invalid STRIPE_CHECKOUT_MODE', 500);
  }

  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("success_url", env.CHECKOUT_SUCCESS_URL);
  params.set("cancel_url", env.CHECKOUT_CANCEL_URL);

  // 商品（Price）を指定
  params.append("line_items[0][price]", env.STRIPE_PRICE_ID);
  params.append("line_items[0][quantity]", "1");

  // Webhook側で誰の支払いかを特定するキー（client_reference_id に統一）
  params.set("client_reference_id", memberId);

  const stripeBase = env.STRIPE_API_BASE_URL?.trim() || "https://api.stripe.com";
  const checkoutUrl = `${stripeBase}/v1/checkout/sessions`;

  let stripeRes: Response;
  try {
    stripeRes = await fetchExternalApi(checkoutUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }, env);
  } catch (e) {
    console.error('checkoutSessionCreateHandler: stripe fetch failed', e);
    return errorResponse('INTERNAL_ERROR', 'stripe fetch failed', 502);
  }

  const stripeData = await stripeRes.json().catch(() => null) as { id?: string; url?: string } | null;
  if (!stripeRes.ok) {
    console.error('checkoutSessionCreateHandler: stripe error', {
      status: stripeRes.status,
      data: stripeData,
    });
    return errorResponse('INTERNAL_ERROR', 'stripe error', 502);
  }

  const response: CheckoutSessionCreateResponse = {
    ok: true,
    id: stripeData?.id ?? "",
    url: stripeData?.url ?? "",
  };
  return json(response, 200);
}
