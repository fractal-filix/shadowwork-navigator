/**
 * Database型定義
 * database/DDL.sql に準拠したD1スキーマ型
 */

// ============================================================================
// Runs テーブル
// ============================================================================

/**
 * Run のステータス
 */
export type RunStatus = 'active' | 'completed';

/**
 * Runs テーブルの行型
 */
export interface RunRow {
  id: string;
  user_id: string;
  run_no: number;
  status: RunStatus;
  created_at: string; // ISO8601 datetime string
  updated_at: string; // ISO8601 datetime string
}

/**
 * Run 作成時の入力型
 */
export interface CreateRunInput {
  id: string;
  user_id: string;
  run_no: number;
  status?: RunStatus;
}

// ============================================================================
// Threads テーブル
// ============================================================================

/**
 * Thread のステータス
 */
export type ThreadStatus = 'active' | 'completed';

/**
 * Thread のステップ（1 = Step1質問, 2 = Step2セッション）
 */
export type ThreadStep = 1 | 2;

/**
 * Threads テーブルの行型
 */
export interface ThreadRow {
  id: string;
  run_id: string;
  user_id: string;
  step: ThreadStep;
  question_no: number | null; // step=1のみ使用
  session_no: number | null;  // step=2のみ使用
  status: ThreadStatus;
  created_at: string; // ISO8601 datetime string
  updated_at: string; // ISO8601 datetime string
}

/**
 * Thread 作成時の入力型
 */
export interface CreateThreadInput {
  id: string;
  run_id: string;
  user_id: string;
  step: ThreadStep;
  question_no?: number | null;
  session_no?: number | null;
  status?: ThreadStatus;
}

// ============================================================================
// Messages テーブル
// ============================================================================

/**
 * Message の役割
 */
export type MessageRole = 'user' | 'assistant';

/**
 * Messages テーブルの行型
 */
export interface MessageRow {
  id: string;
  run_id: string;
  thread_id: string;
  user_id: string;
  role: MessageRole;
  client_message_id: string;
  content: string; // ciphertext
  content_iv: string;
  content_alg: string;
  content_v: number;
  content_kid: string | null;
  seq: number; // thread内での順序（厳密な順序付け用）
  created_at: string; // ISO8601 datetime string
}

/**
 * Message 作成時の入力型
 */
export interface CreateMessageInput {
  id: string;
  run_id: string;
  thread_id: string;
  user_id: string;
  role: MessageRole;
  client_message_id: string;
  content: string;
  content_iv: string;
  content_alg: string;
  content_v: number;
  content_kid?: string | null;
  seq: number;
}

// ============================================================================
// Cards テーブル
// ============================================================================

export type CardKind = 'context_card' | 'step2_meta_card';

export interface CardRow {
  id: string;
  run_id: string;
  thread_id: string | null;
  user_id: string;
  kind: CardKind;
  content: string;
  content_iv: string;
  content_alg: string;
  content_v: number;
  content_kid: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// User Flags テーブル
// ============================================================================

/**
 * User Flags テーブルの行型
 */
export interface UserFlagRow {
  user_id: string;
  paid: 0 | 1; // SQLite INTEGER boolean (0=false, 1=true)
  created_at: string; // ISO8601 datetime string
  updated_at: string; // ISO8601 datetime string
}

/**
 * User Flag 作成時の入力型
 */
export interface CreateUserFlagInput {
  user_id: string;
  paid?: 0 | 1;
}

// ============================================================================
// Stripe Webhook Events テーブル
// ============================================================================

/**
 * Stripe Webhook Events テーブルの行型
 */
export interface StripeWebhookEventRow {
  event_id: string;
  event_type: string;
  created_at: string; // ISO8601 datetime string
}

// ============================================================================
// D1 Result 型（Cloudflare D1 API）
// ============================================================================

/**
 * D1 クエリ結果の型（単一結果）
 */
export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
  };
}

/**
 * D1 実行結果の型（INSERT/UPDATE/DELETE）
 */
export interface D1ExecResult {
  success: boolean;
  meta: {
    duration: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
  };
}
