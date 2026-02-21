// src/lib/run.ts
import type { Env } from '../types/env.js';
import type { RunRow, ThreadRow, ThreadStep } from '../types/database.js';

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

export async function getActiveRun(env: Env, user_id: string): Promise<RunRow | null> {
  return await env.DB
    .prepare(
      `SELECT id, user_id, run_no, status, created_at, updated_at
       FROM runs
       WHERE user_id = ? AND status = 'active'
       LIMIT 1`
    )
    .bind(user_id)
    .first();
}

export async function createRun(env: Env, user_id: string): Promise<RunRow> {
  const next = await env.DB
    .prepare(
      `SELECT COALESCE(MAX(run_no), 0) + 1 AS next_no
       FROM runs
       WHERE user_id = ?`
   )
    .bind(user_id)
    .first<{ next_no: number }>();

  const run_id = uuid();

  try {
    await env.DB
      .prepare(
        `INSERT INTO runs (id, user_id, run_no, status)
         VALUES (?, ?, ?, 'active')`
      )
      .bind(run_id, user_id, Number(next?.next_no ?? 1))
      .run();
  } catch (e) {
    if (!isConstraintError(e)) throw e;
    // 競合で先に active が作られた等の可能性があるので取り直す
    const active = await getActiveRun(env, user_id);
    if (active) return active;
    throw e;
  }

  const run = await getActiveRun(env, user_id);
  if (!run) throw new Error("Failed to create run");
  return run;
}

export async function getActiveThread(env: Env, run_id: string): Promise<ThreadRow | null> {
  return await env.DB
    .prepare(
      `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
       FROM threads
       WHERE run_id = ? AND status = 'active'
       LIMIT 1`
    )
    .bind(run_id)
    .first();
}

export function formatThread(t: ThreadRow | null): ThreadRow | null {
  if (!t) return null;
  return {
    id: t.id,
    run_id: t.run_id,
    user_id: t.user_id,
    step: t.step,
    question_no: t.question_no,
    session_no: t.session_no,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

interface ThreadKeyParams {
  step: ThreadStep;
  question_no?: number | null;
  session_no?: number | null;
}

export async function findThreadByKey(env: Env, run_id: string, { step, question_no, session_no }: ThreadKeyParams): Promise<ThreadRow | null> {
  if (Number(step) === 1) {
    if (question_no == null) return null;
    return await env.DB
      .prepare(
        `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
         FROM threads
         WHERE run_id = ? AND step = 1 AND question_no = ?
         LIMIT 1`
      )
      .bind(run_id, Number(question_no))
      .first();
  }

  if (Number(step) === 2) {
    if (session_no == null) return null;
    return await env.DB
      .prepare(
        `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
         FROM threads
         WHERE run_id = ? AND step = 2 AND session_no = ?
         LIMIT 1`
      )
      .bind(run_id, Number(session_no))
      .first();
  }

  return null;
}

export async function createThreadIfMissing(env: Env, run: RunRow, { step, question_no, session_no }: ThreadKeyParams): Promise<ThreadRow> {
  const existing = await findThreadByKey(env, run.id, { step, question_no, session_no });
  if (existing) return existing;

  // active thread があるなら作らない（API側で close を要求する）
  const active = await getActiveThread(env, run.id);
  if (active) {
    throw new Error("another active thread exists; close it before creating a new one");
  }

  const id = uuid();

  try {
    await env.DB
      .prepare(
        `INSERT INTO threads
          (id, run_id, user_id, step, question_no, session_no, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`
      )
      .bind(id, run.id, run.user_id, step, question_no ?? null, session_no ?? null)
      .run();
  } catch (e) {
    if (!isConstraintError(e)) throw e;

    // (1) まず同キーが作られていないか確認
    const again = await findThreadByKey(env, run.id, { step, question_no, session_no });
    if (again) return again;

    // (2) 競合で active thread が先に作られた可能性があるので、それを返す
    const nowActive = await getActiveThread(env, run.id);
    if (nowActive) return nowActive;

    throw e;
  }

  const thread = await env.DB
    .prepare(
      `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
       FROM threads
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<ThreadRow>();
  
  if (!thread) throw new Error("Failed to create thread");
  return thread;
}

interface NextThreadOptions {
  maxQ?: number;
  maxS?: number;
}

export async function createNextThread(env: Env, run: RunRow, { maxQ = 5, maxS = 30 }: NextThreadOptions = {}): Promise<ThreadRow | null> {
  const qRow = await env.DB
    .prepare(
      `SELECT COALESCE(MAX(question_no), 0) AS max_q
       FROM threads
       WHERE run_id = ? AND step = 1`
    )
    .bind(run.id)
    .first<{ max_q: number }>();

  const max_q = Number(qRow?.max_q ?? 0);
  if (max_q < maxQ) {
    return await createThreadIfMissing(env, run, {
      step: 1,
      question_no: max_q + 1,
      session_no: null,
    });
  }

  const sRow = await env.DB
    .prepare(
      `SELECT COALESCE(MAX(session_no), 0) AS max_s
       FROM threads
       WHERE run_id = ? AND step = 2`
    )
    .bind(run.id)
    .first<{ max_s: number }>();

  const max_s = Number(sRow?.max_s ?? 0);
  const next_s = max_s + 1;

  if (next_s > maxS) {
    await env.DB.prepare(`UPDATE runs SET status = 'completed' WHERE id = ?`).bind(run.id).run();
    return null;
  }

  return await createThreadIfMissing(env, run, {
    step: 2,
    question_no: null,
    session_no: next_s,
  });
}

export async function closeActiveThread(env: Env, run_id: string): Promise<ThreadRow | null> {
  const t = await getActiveThread(env, run_id);
  if (!t) return null;

  await env.DB.prepare(`UPDATE threads SET status = 'completed' WHERE id = ?`).bind(t.id).run();

  return await env.DB
    .prepare(
      `SELECT id, run_id, user_id, step, question_no, session_no, status, created_at, updated_at
       FROM threads
       WHERE id = ?
       LIMIT 1`
    )
    .bind(t.id)
    .first();
}
