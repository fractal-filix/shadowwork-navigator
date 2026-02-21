// src/handlers/llm_respond.ts
import type { Env } from '../types/env.js';
import type { LlmRespondResponse } from '../types/api.js';
import { errorResponse, json, methodNotAllowed, badRequest, unauthorized, forbidden } from "../lib/http.js";
import { authenticateRequest } from '../lib/auth.js';
import { extractOutputText, getOpenAiModel } from '../lib/llm.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { fetchExternalApi } from '../lib/external_api.js';

const MAX_INPUT_LENGTH = 2000;

interface LlmRespondHandlerContext {
  request: Request;
  env: Env;
}

export async function llmRespondHandler({ request, env }: LlmRespondHandlerContext): Promise<Response> {
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
  if (!apiKey) return errorResponse('INTERNAL_ERROR', 'OPENAI_API_KEY is not set', 500);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    // body無しでもOKにしたいなら空扱い
    body = {};
  }

  const input = body?.input;
  if (typeof input !== "string" || !input.trim()) {
    return badRequest("body.input (string) is required");
  }

  const normalizedInput = input.trim();
  if (normalizedInput.length > MAX_INPUT_LENGTH) {
    return badRequest(`body.input is too long (max ${MAX_INPUT_LENGTH} chars)`);
  }

  const model = getOpenAiModel(env);

  const payload = {
    model,
    input: [
        {
            role: "system",
            content: "あなたは簡潔に自己紹介や質問に答えるAIです。必ず日本語で、1文だけで答えてください。"
        },
        {
            role: "user",
          content: normalizedInput
        }
    ]
  };

  const openAiBase = (env as Record<string, unknown>).OPENAI_API_BASE_URL as string | undefined;
  const openAiBaseUrl = openAiBase && openAiBase.trim() ? openAiBase.trim() : 'https://api.openai.com';

  let r: Response;
  try {
    r = await fetchExternalApi(`${openAiBaseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }, env);
  } catch {
    console.error('llmRespondHandler: OpenAI fetch failed');
    return errorResponse('INTERNAL_ERROR', 'OpenAI fetch failed', 502);
  }

  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('llmRespondHandler: OpenAI returned non-JSON', { status: r.status });
    return errorResponse('INTERNAL_ERROR', 'OpenAI returned non-JSON', 502);
  }

  if (!r.ok) {
    console.error('llmRespondHandler: OpenAI error', { status: r.status });
    return errorResponse('INTERNAL_ERROR', 'OpenAI error', 502);
  }

  const response: LlmRespondResponse = {
    ok: true,
    model,
    output_text: extractOutputText(data)
  };
  return json(response);
}
