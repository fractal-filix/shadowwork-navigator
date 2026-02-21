import type { Env } from '../types/env.js';
import type { StripeWebhookResponse } from '../types/api.js';
import { json, methodNotAllowed, badRequest, internalError, errorResponse } from '../lib/http.js';
import { fetchExternalApi } from '../lib/external_api.js';

interface StripeSignatureParsed {
    t: string | null;
    v1: string[];
}

function parseStripeSignature(sigHeader: string): StripeSignatureParsed {
    // e.g. "t=1700000000,v1=abc...,v0=..."
    const parts = sigHeader.split(",").map(s => s.trim());
    const out: StripeSignatureParsed = { t: null, v1: [] };
    for (const p of parts) {
        const [k, v] = p.split("=");
        if (k === "t") out.t = v;
        if (k === "v1") out.v1.push(v);
    }
    return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function bufToHex(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let hex = "";
    for (const x of bytes) hex += x.toString(16).padStart(2, "0");
    return hex;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return bufToHex(sig);
}

interface StripeWebhookContext {
    request: Request;
    env: Env;
}

export async function stripeWebhookHandler({ request, env }: StripeWebhookContext): Promise<Response> {
    if (request.method !== "POST") {
        return methodNotAllowed();
    }

    const sigHeader = request.headers.get("Stripe-Signature") || "";
    if (!sigHeader) {
        return badRequest("missing Stripe-Signature");
    }

    const raw = await request.text(); // 署名検証のため「生」を使う
    const parsed = parseStripeSignature(sigHeader);
    if (!parsed.t || parsed.v1.length === 0) {
        return badRequest("invalid Stripe-Signature format");
    }

    // リプレイ対策（±5分）
    const nowSec = Math.floor(Date.now() / 1000);
    const ts = Number(parsed.t);
    if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) {
        return badRequest("timestamp out of tolerance");
    }

    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        return internalError("STRIPE_WEBHOOK_SECRET is not set");
    }

    const signedPayload = `${parsed.t}.${raw}`;
    const expected = await hmacSha256Hex(secret, signedPayload);

    const ok = parsed.v1.some(v => timingSafeEqualHex(v, expected));
    if (!ok) {
        return badRequest("signature verification failed");
    }

    // ここから event を安全に parse
    let event: Record<string, unknown>;
    try {
        event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return badRequest("invalid JSON");
    }

    const eventId = event?.id as string | undefined;
    const eventType = event?.type as string | undefined;
    if (!eventId || typeof eventId !== "string") {
        return badRequest("event id missing");
    }

    // 冪等性チェック（処理済みなら即OK）
    const existing = await env.DB
        .prepare("SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1")
        .bind(eventId)
        .first();
    const okResponse: StripeWebhookResponse = { ok: true };
    if (existing) {
        return json(okResponse);
    }

    // 必要イベントだけ処理
    if (eventType === "checkout.session.completed") {
        const session = (event?.data as Record<string, unknown>)?.object as Record<string, unknown>;
        const sessionId = session?.id as string | undefined;
        if (!sessionId) {
            return badRequest("session id missing");
        }

        const stripeBase = env.STRIPE_API_BASE_URL?.trim() || "https://api.stripe.com";
        const sessionUrl = `${stripeBase}/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`;

        let fetched: Record<string, unknown>;
        try {
            const stripeRes = await fetchExternalApi(sessionUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
                },
            }, env);

            const bodyText = await stripeRes.text();
            try {
                fetched = JSON.parse(bodyText) as Record<string, unknown>;
            } catch {
                return errorResponse("INTERNAL_ERROR", "stripe session parse error", 502, { status: stripeRes.status });
            }

            if (!stripeRes.ok) {
                return errorResponse("INTERNAL_ERROR", "stripe session fetch failed", 502, { status: stripeRes.status, stripe: fetched });
            }
        } catch (e) {
            return errorResponse("INTERNAL_ERROR", "stripe fetch error", 502, { message: String((e as Error)?.message || e) });
        }

        const paymentStatus = fetched?.payment_status;
        if (paymentStatus !== "paid") {
            return badRequest("payment not paid", { payment_status: paymentStatus });
        }

        const memberId = fetched?.client_reference_id;
        if (typeof memberId !== "string" || !memberId.trim()) {
            return badRequest("client_reference_id not found");
        }

        const priceId = env.STRIPE_PRICE_ID;
        const lineItems = (fetched?.line_items as { data?: Array<Record<string, unknown>> } | undefined)?.data || [];
        const hasPrice = lineItems.some((item) => (item?.price as { id?: string } | undefined)?.id === priceId);
        if (!hasPrice) {
            return badRequest("price mismatch");
        }

        await env.DB.prepare(`
            INSERT INTO user_flags(user_id, paid)
            VALUES(?, 1)
            ON CONFLICT(user_id) DO UPDATE SET paid=excluded.paid
        `).bind(memberId).run();
    }

    await env.DB.prepare(`
        INSERT INTO stripe_webhook_events(event_id, event_type)
        VALUES(?, ?)
        ON CONFLICT(event_id) DO NOTHING
    `).bind(eventId, eventType || "unknown").run();

    // Stripe には 2xx 返せばOK
    return json(okResponse);
}
