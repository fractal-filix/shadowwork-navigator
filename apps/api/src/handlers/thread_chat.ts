import type { Env } from '../types/env.js';
import type { ThreadMessageResponse } from '../types/api.js';
import { errorResponse, json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, getActiveThread, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';
import { extractOutputText, getOpenAiModel } from '../lib/llm.js';
import { fetchExternalApi } from '../lib/external_api.js';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_CARD_LENGTH = 200;
const MAX_STEP2_META_CARD_LENGTH = 400;

function buildSystemPrompt(step: number, questionNo?: number | null, sessionNo?: number | null): string {
  if (Number(step) === 1) {
    return `あなたはシャドーワークのガイドです。ユーザーの回答を受けて、Q${questionNo ?? ''}について具体例を1つだけ短く促してください。日本語で2文以内。`;
  }
  if (Number(step) === 2) {
    return `あなたはシャドーワークのガイドです。Session ${sessionNo ?? ''}で感情が強く出た瞬間を、状況→相手→自分の反応の順に書くよう短く促してください。日本語で2文以内。`;
  }
  return "あなたはシャドーワークのガイドです。ユーザーの回答を短く深掘りする質問を日本語で2文以内で返してください。";
}

function buildNextActionReply(step: number, questionNo: number | null, sessionNo: number | null): string {
  if (Number(step) === 1) {
    return `次へ進みます。Q${questionNo ?? ''}で出てきた感情の中で、いま最も強く残っているものを一つ書いてください。`;
  }
  if (Number(step) === 2) {
    return `次へ進みます。Session ${sessionNo ?? ''}で最も強く反応した感情を一つ書いてください。`;
  }
  return '次へ進みます。いま最も強く残っている感情を一つ書いてください。';
}

async function generateAssistantReply(
  env: Env,
  step: number,
  questionNo: number | null,
  sessionNo: number | null,
  userText: string,
  contextCard: string,
  step2MetaCard: string | null,
): Promise<{ ok: true; reply: string } | { ok: false; response: Response }> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, response: errorResponse('INTERNAL_ERROR', 'OPENAI_API_KEY is not set', 500) };

  const model = getOpenAiModel(env);
  const openAiBase = (env as Record<string, unknown>).OPENAI_API_BASE_URL as string | undefined;
  const openAiBaseUrl = openAiBase && openAiBase.trim() ? openAiBase.trim() : "https://api.openai.com";
  const payload = {
    model,
    input: [
      { role: "system", content: buildSystemPrompt(step, questionNo, sessionNo) },
      { role: "system", content: `[context_card]\n${contextCard}` },
      ...(Number(step) === 2 && step2MetaCard
        ? [{ role: "system", content: `[step2_meta_card]\n${step2MetaCard}` }]
        : []),
      { role: "user", content: userText }
    ]
  };

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
    return {
      ok: false,
      response: errorResponse('INTERNAL_ERROR', 'OpenAI fetch failed', 502),
    };
  }

  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: errorResponse('INTERNAL_ERROR', 'OpenAI returned non-JSON', 502),
    };
  }

  if (!r.ok) {
    return {
      ok: false,
      response: errorResponse('INTERNAL_ERROR', 'OpenAI error', 502),
    };
  }

  const reply = extractOutputText(data);
  if (!reply || !reply.trim()) {
    return {
      ok: false,
      response: errorResponse('INTERNAL_ERROR', 'OpenAI returned empty output', 502),
    };
  }

  return { ok: true, reply: reply.trim() };
}

interface ThreadChatHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadChatHandler({ request, env, url }: ThreadChatHandlerContext): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const user_id = authContext.memberId;

  const isPaid = await getUserPaidFlag(env, user_id);
  if (!isPaid) {
    return forbidden('Paid access required');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const message = body.message;
  const action = body.action;
  const contextCard = body.context_card;
  const step2MetaCard = body.step2_meta_card;

  if (typeof action !== 'undefined' && action !== 'next') {
    return badRequest('action must be "next" when provided');
  }

  const run = await getActiveRun(env, user_id);
  if (!run) return badRequest("no active run; call /api/run/start (or /api/run/restart)");
  const thread = await getActiveThread(env, run.id);

  if (!thread) {
    return badRequest("no active thread; call /api/thread/start first");
  }

  if (thread.status !== "active") {
    return badRequest("thread is not active");
  }

  if (action === 'next') {
    const response: ThreadMessageResponse = {
      ok: true,
      run: { id: run.id, run_no: run.run_no, status: run.status },
      thread: formatThread(thread)!,
      thread_id: thread.id,
      reply: buildNextActionReply(thread.step, thread.question_no, thread.session_no),
    };
    return json(response);
  }

  if (typeof message !== "string" || !message.trim()) {
    return badRequest("message is required");
  }

  if (typeof contextCard !== 'string' || !contextCard.trim()) {
    return badRequest('context_card is required');
  }

  if (contextCard.trim().length > MAX_CONTEXT_CARD_LENGTH) {
    return badRequest(`context_card is too long (max ${MAX_CONTEXT_CARD_LENGTH} chars)`);
  }

  if (typeof step2MetaCard !== 'undefined' && step2MetaCard !== null && typeof step2MetaCard !== 'string') {
    return badRequest('step2_meta_card must be string when provided');
  }

  if (typeof step2MetaCard === 'string' && step2MetaCard.trim().length > MAX_STEP2_META_CARD_LENGTH) {
    return badRequest(`step2_meta_card is too long (max ${MAX_STEP2_META_CARD_LENGTH} chars)`);
  }

  if (Number(thread.step) === 2 && (typeof step2MetaCard !== 'string' || !step2MetaCard.trim())) {
    return badRequest('step2_meta_card is required on step2');
  }

  const content = message.trim();
  if (content.length > MAX_MESSAGE_LENGTH) {
    return badRequest(`message is too long (max ${MAX_MESSAGE_LENGTH} chars)`);
  }

  const replyResult = await generateAssistantReply(
    env,
    thread.step,
    thread.question_no,
    thread.session_no,
    content,
    contextCard.trim(),
    typeof step2MetaCard === 'string' ? step2MetaCard.trim() : null,
  );
  if (!replyResult.ok) return replyResult.response;

  const response: ThreadMessageResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
    thread: formatThread(thread)!,
    thread_id: thread.id,
    reply: replyResult.reply,
  };
  return json(response);
}
