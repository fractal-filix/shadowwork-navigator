// src/handlers/llm_ping.ts
import type { Env } from '../types/env.js';
import type { LlmPingResponse } from '../types/api.js';
import { errorResponse, json, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';
import { extractOutputText, getOpenAiModel } from '../lib/llm.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { fetchExternalApi } from '../lib/external_api.js';

interface LlmPingHandlerContext {
  request: Request;
  env: Env;
}

export async function llmPingHandler({ request, env }: LlmPingHandlerContext): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  // JWT認証必須
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const isPaid = await getUserPaidFlag(env, authContext.memberId);
  if (!isPaid) {
    return forbidden('Paid access required');
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return errorResponse('INTERNAL_ERROR', 'OPENAI_API_KEY is not set', 500);
  }

  const model = getOpenAiModel(env);

  const payload = {
    model,
    input: "Reply with exactly: pong"
  };

  const openAiBase = (env as Record<string, unknown>).OPENAI_API_BASE_URL as string | undefined;
  const openAiBaseUrl = openAiBase && openAiBase.trim() ? openAiBase.trim() : 'https://api.openai.com';

  let r: Response;
  try {
    r = await fetchExternalApi(`${openAiBaseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // OpenAIはBearer認証 :contentReference[oaicite:2]{index=2}
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }, env);
  } catch {
    console.error('llmPingHandler: OpenAI fetch failed');
    return errorResponse('INTERNAL_ERROR', 'OpenAI fetch failed', 502);
  }

  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('llmPingHandler: OpenAI returned non-JSON', { status: r.status });
    return errorResponse('INTERNAL_ERROR', 'OpenAI returned non-JSON', 502);
  }

  if (!r.ok) {
    console.error('llmPingHandler: OpenAI error', { status: r.status });
    return errorResponse('INTERNAL_ERROR', 'OpenAI error', 502);
  }

  const response: LlmPingResponse = {
    ok: true,
    model,
    pong: extractOutputText(data)
  };
  return json(response);
}
