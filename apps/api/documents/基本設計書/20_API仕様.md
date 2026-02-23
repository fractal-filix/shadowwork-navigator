# 20_API仕様

本章では、filix-shadowwork-api が提供する Application Programming Interface（API）の外部仕様を定義する。  
各エンドポイントの**目的、入力、出力、認証、およびエラー形式**を示し、フロントエンドとの契約（contract）とする。

---

## 共通仕様

### ベースURL
- 環境ごとに異なる（例: Cloudflare Workers のデプロイ先）
- 以降のパスはすべてベースURL配下の相対パスとして記載する

### Content-Type
- リクエストボディがある場合は原則 `application/json`
- レスポンスは原則 `application/json`

### 認証（Authentication）
本APIは、JWT による認証が必須です（`/api/auth/exchange` を除く）。  
クライアントは以下の流れで認証を行います：

1. `POST /api/auth/exchange` で Memberstack トークンを渡し、JWT（Cookie）を取得
2. 以後の API リクエストでは、Cookie に含まれる JWT が自動的に送信される
3. バックエンドは JWT の署名を検証し、`sub` クレーム（= memberId）を用いてユーザーを特定

**重要**: すべてのエンドポイントで、クライアントは `user_id` パラメータを送信してはいけません。  
ユーザーIDはすべて JWT から確定されます（認証なしでは処理されません）。

詳細は `50_セキュリティ` の「認証方式（JWT + Cookie）」を参照。

> 注: 本章では API契約として「JWT で認証が必須」「user_id は送信不要」を記載する。  
> 検証手順の詳細は `50_セキュリティ` を参照。

### 利用権限（Authorization / 利用権限）
有料状態（paid）などの利用権限は、各機能のアクセス可否に影響する。  
paid判定や webhook 反映の詳細は `40_課金と利用権限` に記載する。

### クエリパラメータ
- `GET` の取得系ではクエリパラメータを使用する場合がある（詳細は各エンドポイント）

---

## 共通エラー形式（Error response）

すべてのエンドポイントは、失敗時に共通の JSON 形式でエラーを返す。

```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "説明文（人間向け）"
  }
}
```

- `ok`: 成否フラグ（失敗時は `false`）
- `error.code`: エラー種別（例: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_ERROR`）
- `error.message`: 画面表示やログのための説明文

HTTPステータスはエラー種別に応じて設定する（例: 400/401/403/404/500）。  
※実装上のステータス割当は変更され得るが、**成功時に `ok: true` を返す**こと、**失敗時に上記形式を返す**ことを契約とする。

### 代表的なエラー例

#### CORS 許可外 Origin（403）
```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "origin not allowed"
  }
}
```

#### 外部APIタイムアウト等の上流失敗（502）
```json
{
  "ok": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "OpenAI fetch failed"
  }
}
```

上記 `502` は OpenAI/Stripe/Memberstack などの外部依存に起因する失敗を含む。  
外部API呼び出しのタイムアウト制御は `EXTERNAL_API_TIMEOUT_MS` に従う。

---

## エンドポイント一覧

### 認証
- `POST /api/auth/exchange`  
  Memberstack トークンから JWT を発行。

### ヘルスチェック
- `GET /`  
  サービス稼働確認。

### 課金・利用権限
- `GET /api/paid`  
  指定ユーザーの paid 状態を返す。
- `POST /api/admin/set_paid`  
  管理用途。指定ユーザーの paid 状態を更新する。

### スレッド（thread）
- `POST /api/thread/start`  
  スレッド開始。
- `POST /api/thread/chat`  
  LLM中継（平文を受け取り応答を返す。保存はしない）。
- `POST /api/thread/context_card`  
  スレッド単位の `context_card` 暗号文を保存（upsert）する。
- `GET /api/thread/context_card`  
  スレッド単位の `context_card` 暗号文を取得する。
- `POST /api/thread/message`  
  暗号化済みメッセージを保存する。
- `GET /api/thread/state`  
  スレッド状態取得。
- `POST /api/thread/close`  
  スレッド終了。
- `GET /api/thread/messages`  
  スレッドのメッセージ一覧取得。

### 実行（run）
- `POST /api/run/start`  
  実行開始。
- `POST /api/run/restart`  
  実行再開（続きから進める想定）。
- `POST /api/run/step2_meta_card`  
  active run 単位の `step2_meta_card` 暗号文を保存（upsert）する。
- `GET /api/run/step2_meta_card`  
  active run 単位の `step2_meta_card` 暗号文を取得する。
- `GET /api/runs/list`  
  実行一覧取得。

### スレッド一覧
- `GET /api/threads/list`  
  スレッド一覧取得。

### LLM（管理・検証用途）
- `POST /api/llm/ping`  
  LLM疎通確認。
- `POST /api/llm/respond`  
  LLM応答生成（検証・開発用途を想定）。

---

## エンドポイント仕様（詳細）

以下は「最低限の契約」を示す。  
**リクエスト/レスポンスの厳密なフィールド定義（JSON schema）は必要になった段階で追加する**。

---

### GET /

**目的**: 稼働確認。  
**認証**: 不要。  
**成功レスポンス例**:
```json
{ "ok": true }
```

---

### GET /api/paid

**目的**: 認証ユーザーの paid 状態を返す。  
**認証**: 必要（方式は `50_セキュリティ`）。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス例**:
```json
{ "ok": true, "paid": true }
```

---

### POST /api/admin/set_paid

**目的**: 管理用途で paid 状態を更新する。  
**認証**: 強い制限が必須（詳細は `50_セキュリティ`）。  
  - JWT（Cookie）で管理者（memberId）を特定し、`ADMIN_MEMBER_IDS` allowlist に含まれること
  - 管理トークンが一致すること（`X-PAID-ADMIN-TOKEN: <token>`）
**入力**: JSON（例）
```json
{ "user_id": "xxx", "paid": true }
```

**成功レスポンス例**:
```json
{ "ok": true }
```

---

### POST /api/thread/start

**目的**: シャドウワークのスレッドを開始する。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true, "thread_id": "t_xxx", "run_id": "r_xxx" }
```

---

### POST /api/thread/chat

**目的**: AI応答生成のための中継。平文を受け取り、LLMに送信して応答を返す。  
**認証**: 必要。  
**入力**: JSON（例）
```json
{
  "message": "text",
  "context_card": "- 箇条書き\n- 200字以内",
  "step2_meta_card": "- Step2の重要気づき（Step2時のみ、400字以内）"
}
```

**成功レスポンス（例）**:
```json
{ "ok": true, "reply": "text", "thread_state": { } }
```

補足:
- 本エンドポイントは平文を永続化しない。
- LLM利用料金の抑制を目的とした入力文字数制限は、本エンドポイントの平文入力（`message`）に対して適用する。
- `context_card` は必須（200文字以下）。
- `step2_meta_card` は Step2 の thread では必須（400文字以下）。
- `action: "next"` 指定時はLLM呼び出しを行わず、次アクション用の文面を返す。

---

### POST /api/thread/context_card

**目的**: スレッド単位の `context_card` を暗号文で保存（upsert）する。  
**認証**: 必要。  
**入力**: JSON（例）
```json
{
  "thread_id": "t_xxx",
  "ciphertext": "base64...",
  "iv": "base64...",
  "alg": "AES-256-GCM",
  "v": 1,
  "kid": "k1"
}
```

---

### GET /api/thread/context_card

**目的**: スレッド単位の `context_card` 暗号文を取得する。  
**認証**: 必要。  
**入力**: クエリ（例）
- `thread_id`（必須）

---

### POST /api/run/step2_meta_card

**目的**: active run 単位の `step2_meta_card` を暗号文で保存（upsert）する。  
**認証**: 必要。  
**入力**: JSON（例）
```json
{
  "ciphertext": "base64...",
  "iv": "base64...",
  "alg": "AES-256-GCM",
  "v": 1,
  "kid": "k1"
}
```

---

### GET /api/run/step2_meta_card

**目的**: active run 単位の `step2_meta_card` 暗号文を取得する。  
**認証**: 必要。  
**入力**: なし（active run を参照）

---

### POST /api/thread/message

**目的**: 暗号化済みメッセージ（暗号文＋メタ情報）を保存する。  
**認証**: 必要。  
**入力**: JSON（例）
```json
{
  "thread_id": "t_xxx",
  "role": "user",
  "client_message_id": "cm_xxx",
  "ciphertext": "base64...",
  "iv": "base64...",
  "alg": "AES-256-GCM",
  "v": 1,
  "kid": "k1"
}
```

**成功レスポンス（例）**:
```json
{
  "ok": true,
  "thread_id": "t_xxx",
  "message": {
    "role": "user",
    "client_message_id": "cm_xxx"
  }
}
```

補足:
- サーバは平文を受け付けない。
- バックエンドは復号鍵を保持しないため、暗号文を復号できない（復号はフロントエンド側の責務）。
- `client_message_id` により保存リトライ時の重複登録を防ぐ（冪等）。
- 本エンドポイントの暗号文入力（`ciphertext`/`iv`/`alg`）は、LLM利用料金の制御対象ではない。
- 暗号文入力の検証は、保存API保護（異常入力・過大リクエスト対策）を目的として実施する。

#### `client_message_id` 採番規約（フロント実装）

- 1メッセージ（1回の保存対象）につき、クライアントが一意なIDを生成する。
- 形式は UUIDv4 などの十分なランダム性を持つ文字列を推奨する。
- 同じメッセージを再送する場合は、**同じ** `client_message_id` を再利用する。
- 新しいメッセージを保存する場合は、必ず新しい `client_message_id` を採番する。
- `client_message_id` はメッセージ本文そのものや個人情報を含めない。

#### 保存失敗時のUI状態（クライアント指針）

フロントは保存状態を明示し、少なくとも以下の状態を表現する。

- `saved`: 保存済み（サーバが `ok: true` を返却）
- `pending_retry`: 保存失敗。再試行可能な状態
- `not_saved`: ユーザー離脱や再試行上限到達等で未保存が確定した状態

推奨フロー:
1. `POST /api/thread/chat` でAI応答を取得
2. 端末で暗号化し、`POST /api/thread/message` で保存
3. 保存失敗時は `pending_retry` を表示し、同じ `client_message_id` で再送
4. 最終的に保存できなかった場合は `not_saved` を表示

---

### GET /api/thread/state

**目的**: スレッドの状態を取得する。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true, "state": { } }
```

---

### POST /api/thread/close

**目的**: スレッドを終了する。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true }
```

---

### GET /api/thread/messages

**目的**: スレッドに紐づくメッセージ一覧を取得する。  
**認証**: 必要。  
**入力**: クエリ（例）
- `thread_id`（必須）
- `limit`（任意）

**成功レスポンス（例）**:
```json
{
  "ok": true,
  "messages": [
    {
      "role": "user",
      "client_message_id": "cm_xxx",
      "ciphertext": "base64...",
      "iv": "base64...",
      "alg": "AES-256-GCM",
      "v": 1,
      "kid": "k1"
    }
  ]
}
```

補足:
- 返却は暗号文とメタ情報のみ（平文本文は返却しない）。

---

## クライアント実装上の注意（メッセージ保存）

- `POST /api/thread/chat` と `POST /api/thread/message` は分離された責務である。
- AI応答成功は保存成功を意味しないため、保存結果は別途判定する。
- バックエンドは復号鍵を保持しないため、履歴暗号文の復号は行えない。
- `context_card` / `step2_meta_card` は暗号文として保存し、AI送信時はフロントが復号した平文を `POST /api/thread/chat` に同梱する。
- 「直近 n 回 + 要約」をAIに送る場合、フロントは履歴暗号文を復号して組み立てる。
- 履歴復号に必要な鍵が無い/不正な場合は、AI送信前にユーザーへ再設定を促す。

---

### POST /api/run/start

**目的**: 実行（run）を開始する。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true, "run_id": "r_xxx" }
```

---

### POST /api/run/restart

**目的**: 実行（run）を再開する。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true, "run_id": "r_xxx" }
```

---

### GET /api/runs/list

**目的**: 認証ユーザーの実行（run）一覧を返す。  
**認証**: 必要。  
**入力**: なし（ユーザーは JWT から確定）

**成功レスポンス（例）**:
```json
{ "ok": true, "runs": [ { } ] }
```

---

### GET /api/threads/list

**目的**: 認証ユーザーのスレッド一覧を返す。  
**認証**: 必要。  
**入力**: クエリ（例）
- `run_no`（任意）

**成功レスポンス（例）**:
```json
{ "ok": true, "threads": [ { } ] }
```

---

### POST /api/llm/ping

**目的**: LLM疎通確認。  
**認証**: 原則必要（開発用途のため制限推奨）。  
**入力**: JSON（必要なら）
```json
{ "ok": true }
```

---

### POST /api/llm/respond

**目的**: LLM応答生成（検証用途）。  
**認証**: 原則必要（開発用途のため制限推奨）。  
**入力**: JSON（例）
```json
{ "input": "text" }
```

---

## 認証エンドポイント詳細

### POST /api/auth/exchange

**目的**: Memberstack トークンから JWT（Access Token）を発行し、Cookie として返す。

**認証**: 不要（このエンドポイントのみ認証なし）

**入力**（JSON）
```json
{
  "token": "memberstack-login-token-here"
}
```
- `token`（必須）：Memberstack が発行したログイン証明トークン

**処理**
1. Memberstack API でトークンを検証し memberId を取得
2. 検証失敗時は 401 を返す
3. JWT を以下の仕様で生成
4. Cookie に設定して返す

**出力**（JSON）
```json
{
  "ok": true,
  "member_id": "mem_xxxxx",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Cookie設定**
```
Set-Cookie: access_token=<JWT>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
```
- JWT の有効期限：900秒（15分）
- 以後のリクエストでは自動的に Cookie が送信される

**エラーレスポンス**（例）
```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid Memberstack token"
  }
}
```

**ステータスコード**
- 200：成功
- 400：リクエスト形式エラー（token がない等）
- 401：認証失敗（Memberstack トークンが無効）
- 500：サーバーエラー

---
````

**成功レスポンス（例）**:
```json
{ "ok": true, "reply": "text" }
```

---

## 備考（実装との整合性）
- 各リクエスト/レスポンスの詳細フィールドは、実装の進展に合わせて追記する。
- 本章は「詳細設計」ではなく、フロントとバックの契約として必要な事項に限定して記載する。

