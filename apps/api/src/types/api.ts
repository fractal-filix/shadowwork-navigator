/**
 * API共通レスポンス型定義
 * 
 * 基本設計書 20_API仕様.md に準拠した型定義。
 * 段階的な移行を可能にするため、既存のレスポンス形式も考慮。
 */

// ============================================================================
// エラーレスポンス
// ============================================================================

/**
 * エラーコード（共通エラー形式）
 * 基本設計書 20_API仕様.md で定義されたコード
 */
export type ErrorCode =
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR';

/**
 * エラー詳細オブジェクト
 */
export interface ErrorDetail {
    code: ErrorCode;
    message: string;
    details?: unknown;
}

/**
 * エラーレスポンス（標準形式）
 * 基本設計書 20_API仕様.md に準拠
 */
export interface ErrorResponse {
    ok: false;
    error: ErrorDetail;
}

/**
 * レガシーエラーレスポンス（既存コードとの互換性用）
 * 段階的に ErrorResponse へ移行する
 */
export interface LegacyErrorResponse {
    error: string;
    details?: unknown;
}

// ============================================================================
// 成功レスポンス
// ============================================================================

/**
 * 成功レスポンスの基底型
 */
export interface SuccessResponse {
    ok: true;
}

/**
 * ヘルスチェックレスポンス
 * GET /
 */
export interface HealthResponse extends SuccessResponse { }

/**
 * 有料状態レスポンス
 * GET /api/paid
 */
export interface PaidResponse extends SuccessResponse {
    paid: boolean;
}

/**
 * 管理用有料状態更新レスポンス
 * POST /api/admin/set_paid
 */
export interface AdminSetPaidResponse extends SuccessResponse {
    user_id: string;
    paid: number; // 0 | 1
}

/**
 * 認証トークン交換レスポンス
 * POST /api/auth/exchange
 */
export interface AuthExchangeResponse extends SuccessResponse {
    member_id: string;
    token_type: 'Bearer';
    expires_in: number;
}

// ============================================================================
// Run / Thread / Message 関連の共通型
// ============================================================================

/**
 * Run の概要情報
 */
export interface RunSummary {
    id: string;
    run_no: number;
    status: 'active' | 'completed';
}

/**
 * Run の詳細情報（一覧取得用）
 */
export interface RunDetail extends RunSummary {
    created_at: string;
    updated_at: string;
}

/**
 * Thread の詳細情報
 */
export interface ThreadDetail {
    id: string;
    run_id: string;
    user_id: string;
    step: number;
    question_no: number | null;
    session_no: number | null;
    status: 'active' | 'completed';
    created_at: string;
    updated_at: string;
}

/**
 * Message の情報
 */
export interface MessageDetail {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    seq?: number;
    created_at?: string;
}

export interface EncryptedMessageDetail {
    id?: string;
    role: 'user' | 'assistant';
    client_message_id: string;
    ciphertext: string;
    iv: string;
    alg: string;
    v: number;
    kid?: string | null;
    seq?: number;
    created_at?: string;
}

// ============================================================================
// Thread 関連のレスポンス
// ============================================================================

/**
 * スレッド開始レスポンス
 * POST /api/thread/start
 */
export interface ThreadStartResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
}

/**
 * スレッドメッセージ送信レスポンス
 * POST /api/thread/message
 */
export interface ThreadMessageResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
    thread_id: string;
    reply: string;
}

export interface ThreadMessageStoreResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
    thread_id: string;
    message: {
        client_message_id: string;
        role: 'user' | 'assistant';
    };
}

/**
 * スレッド状態取得レスポンス
 * GET /api/thread/state
 */
export interface ThreadStateResponse extends SuccessResponse {
    run: RunSummary | null;
    thread: ThreadDetail | null;
    last_message: EncryptedMessageDetail | null;
}

/**
 * スレッド終了レスポンス
 * POST /api/thread/close
 */
export interface ThreadCloseResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
}

/**
 * スレッドメッセージ一覧レスポンス
 * GET /api/thread/messages
 */
export interface ThreadMessagesResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
    messages: EncryptedMessageDetail[];
    page: {
        limit: number;
    };
}

export interface EncryptedCardPayload {
    ciphertext: string;
    iv: string;
    alg: string;
    v: number;
    kid?: string | null;
}

export interface ThreadContextCardResponse extends SuccessResponse {
    run: RunSummary;
    thread: ThreadDetail;
    card: EncryptedCardPayload;
}

export interface RunStep2MetaCardResponse extends SuccessResponse {
    run: RunSummary;
    card: EncryptedCardPayload;
}

// ============================================================================
// Run 関連のレスポンス
// ============================================================================

/**
 * Run開始レスポンス
 * POST /api/run/start
 */
export interface RunStartResponse extends SuccessResponse {
    run: RunSummary;
}

/**
 * Run再開レスポンス
 * POST /api/run/restart
 */
export interface RunRestartResponse extends SuccessResponse {
    run: RunSummary;
}

/**
 * Run一覧レスポンス
 * GET /api/runs/list
 */
export interface RunsListResponse extends SuccessResponse {
    runs: RunDetail[];
}

/**
 * Thread一覧レスポンス
 * GET /api/threads/list
 */
export interface ThreadsListResponse extends SuccessResponse {
    run: RunSummary | null;
    threads: ThreadDetail[];
}

// ============================================================================
// LLM 関連のレスポンス
// ============================================================================

/**
 * LLM疎通確認レスポンス
 * POST /api/llm/ping
 */
export interface LlmPingResponse extends SuccessResponse {
    model: string;
    pong: string | null;
}

/**
 * LLM応答生成レスポンス
 * POST /api/llm/respond
 */
export interface LlmRespondResponse extends SuccessResponse {
    model: string;
    output_text: string | null;
}

// ============================================================================
// Checkout 関連のレスポンス
// ============================================================================

/**
 * Checkout セッション作成レスポンス
 * POST /api/checkout/session
 */
export interface CheckoutSessionCreateResponse extends SuccessResponse {
    id: string;
    url: string;
}

/**
 * Stripe Webhook 受信成功レスポンス
 * POST /api/stripe/webhook
 */
export interface StripeWebhookResponse extends SuccessResponse {}

// ============================================================================
// ユニオン型（型ガード用）
// ============================================================================

/**
 * すべてのAPIレスポンス型のユニオン
 */
export type ApiResponse =
    | ErrorResponse
    | HealthResponse
    | PaidResponse
    | AuthExchangeResponse
    | AdminSetPaidResponse
    | ThreadStartResponse
    | ThreadMessageResponse
    | ThreadStateResponse
    | ThreadCloseResponse
    | ThreadMessagesResponse
    | ThreadContextCardResponse
    | RunStep2MetaCardResponse
    | RunStartResponse
    | RunRestartResponse
    | RunsListResponse
    | ThreadsListResponse
    | LlmPingResponse
    | LlmRespondResponse
    | CheckoutSessionCreateResponse
    | StripeWebhookResponse;

// ============================================================================
// 型ガード
// ============================================================================

/**
 * 成功レスポンスかどうかを判定
 */
export function isSuccessResponse(response: ApiResponse): response is Extract<ApiResponse, { ok: true }> {
    return response.ok === true;
}

/**
 * エラーレスポンスかどうかを判定
 */
export function isErrorResponse(response: ApiResponse): response is ErrorResponse {
    return response.ok === false && 'error' in response && typeof response.error === 'object';
}
