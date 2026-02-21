import type { Env } from '../types/env.js';
import type { ThreadMessageStoreResponse } from '../types/api.js';
import type { MessageRole } from '../types/database.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, getActiveThread, formatThread } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

const MAX_CLIENT_MESSAGE_ID_LENGTH = 128;
const MAX_KID_LENGTH = 128;

function uuid(): string {
  return crypto.randomUUID();
}

function isConstraintError(e: unknown): boolean {
  const msg = String((e as Error)?.message || e);
  return (
    msg.includes("SQLITE_CONSTRAINT") ||
    msg.toLowerCase().includes("constraint") ||
    msg.toLowerCase().includes("unique")
  );
}

interface InsertEncryptedMessageParams {
  run_id: string;
  thread_id: string;
  user_id: string;
  role: MessageRole;
  client_message_id: string;
  ciphertext: string;
  iv: string;
  alg: string;
  v: number;
  kid: string | null;
}

async function insertEncryptedMessageWithSeq(env: Env, {
  run_id,
  thread_id,
  user_id,
  role,
  client_message_id,
  ciphertext,
  iv,
  alg,
  v,
  kid,
}: InsertEncryptedMessageParams): Promise<'inserted' | 'duplicate'> {
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await env.DB.prepare(
        `INSERT INTO messages
          (id, run_id, thread_id, user_id, role, client_message_id, content, content_iv, content_alg, content_v, content_kid, seq)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (
            SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ?
          ))`
      )
        .bind(
          uuid(),
          run_id,
          thread_id,
          user_id,
          role,
          client_message_id,
          ciphertext,
          iv,
          alg,
          v,
          kid,
          thread_id
        )
        .run();

      return 'inserted';
    } catch (e) {
      if (!isConstraintError(e)) throw e;

      const existing = await env.DB
        .prepare(
          `SELECT id
           FROM messages
           WHERE thread_id = ? AND client_message_id = ?
           LIMIT 1`
        )
        .bind(thread_id, client_message_id)
        .first<{ id: string }>();

      if (existing?.id) {
        return 'duplicate';
      }

      if (i === maxRetries - 1) throw e;
    }
  }

  return 'duplicate';
}

interface ThreadMessageHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function threadMessageHandler({ request, env, url }: ThreadMessageHandlerContext): Promise<Response> {
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

  const role = body.role;
  const clientMessageId = body.client_message_id;
  const ciphertext = body.ciphertext;
  const iv = body.iv;
  const alg = body.alg;
  const version = body.v;
  const kid = body.kid;
  const thread_id = body.thread_id;

  if (role !== 'user' && role !== 'assistant') {
    return badRequest('role must be "user" or "assistant"');
  }

  if (typeof clientMessageId !== 'string' || !clientMessageId.trim()) {
    return badRequest('client_message_id is required');
  }

  if (clientMessageId.trim().length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
    return badRequest(`client_message_id must be <= ${MAX_CLIENT_MESSAGE_ID_LENGTH} chars`);
  }

  if (typeof ciphertext !== 'string' || !ciphertext.trim()) {
    return badRequest('ciphertext is required');
  }

  if (typeof iv !== 'string' || !iv.trim()) {
    return badRequest('iv is required');
  }

  if (typeof alg !== 'string' || !alg.trim()) {
    return badRequest('alg is required');
  }

  if (!Number.isInteger(version) || Number(version) <= 0) {
    return badRequest('v must be a positive integer');
  }

  if (typeof thread_id !== 'string' || !thread_id.trim()) {
    return badRequest('thread_id is required');
  }

  if (typeof kid !== 'undefined' && kid !== null && typeof kid !== 'string') {
    return badRequest('kid must be string when provided');
  }

  if (typeof kid === 'string' && kid.trim().length > MAX_KID_LENGTH) {
    return badRequest(`kid must be <= ${MAX_KID_LENGTH} chars`);
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

  if (thread.id !== thread_id.trim()) {
    return badRequest('thread_id must be current active thread');
  }

  await insertEncryptedMessageWithSeq(env, {
    run_id: run.id,
    thread_id: thread.id,
    user_id,
    role,
    client_message_id: clientMessageId.trim(),
    ciphertext: ciphertext.trim(),
    iv: iv.trim(),
    alg: alg.trim(),
    v: Number(version),
    kid: typeof kid === 'string' ? kid.trim() : null,
  });

  const response: ThreadMessageStoreResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
    thread: formatThread(thread)!,
    thread_id: thread.id,
    message: {
      role,
      client_message_id: clientMessageId.trim(),
    },
  };
  return json(response);
}
