# β版スプリント計画（カード無し）

作成日: 2026-02-28

## 目的（βで「使える」定義）
β版で最低限成立させる体験は以下。

1. ログイン（Supabase Auth → `/api/auth/exchange` → 自前JWT Cookie）
2. 購入（Stripe Checkout）
3. チャット（`/api/thread/chat` でLLM応答を生成し、暗号化して保存）
4. 履歴確認（暗号文保存 → ブラウザで復号して表示）
5. Step1/Step2 ナビ（run/threadの一覧・状態遷移）
6. AIガイド（Qdrantで関連チャンクを注入するRAG）
7. セキュリティ（Cookie運用/CORS、Secrets管理、ログ抑制、権限制御）

## 重要な前提（設計として確定）

### カードは存在しない
- `context_card` / `step2_meta_card` / `cards` テーブル / カード用APIは **完全に廃止**する。
- これらは設計書・DDL・型・テスト・ルーティング・実装から削除する。

### 本文は封筒暗号（最初から必須）
- **本文（メッセージ全文）は封筒暗号で暗号化して保存**する。
  - 本文はDEK（共通鍵）で暗号化し、DEKはKEKで暗号化（ラップ）して保存する。
  - KEKは鍵管理基盤（KMS等）で保管・ローテーション・監査し、DBにKEKは保存しない。
  - APIの暗号メタは `wrapped_key`, `wrapped_key_alg`, `wrapped_key_kid` を含む。

**鍵管理方式（決定）**: 非対称ラップ（クライアント生成DEKを公開鍵でラップして送信）
- 理由: バックエンドが平文DEKに触れない運用が容易で、誤読リスクを下げられるため。

### RAG（Qdrant）はβ必須
- **Qdrant（ベクトルDB）を活かすため、検索用チャンクは本文と別系統で保存**する。
  - チャンクはやむを得ず平文を含みうる（本文と同等に機微情報として扱う）。
  - Qdrantは「検索インデックス」であり本文の正はD1（暗号文）。

### カスタムドメインと SameSite=Strict（βの前提）
- Web: `shadowwork-navigator.com`
- API: `api.shadowwork-navigator.com`
- 上記は同一eTLD+1配下のため、**SameSite=Strict Cookie運用の前提を満たす**。

## スコープ外（βではやらない）
- 精度最適化（プロンプト改善の作り込み、評価基盤）
- 高度な鍵ローテ/再暗号化の完全自動化
- 退会・削除の完全運用（ただし削除伝播の設計/フックは入れる）

## PR分割

### PR#1 同一site前提の確立（CORS/credentials/Set-Cookie）
**狙い**: `shadowwork-navigator.com` → `api.shadowwork-navigator.com` のブラウザ通信で、JWT Cookie（SameSite=Strict）が確実に機能する状態にする。

#### セットアップ（アカウント作成/初期設定）

##### Supabase（未着手 → 必須）
- Supabaseアカウント作成
- Project作成（リージョン/プラン決定）
- Auth有効化（Email+Password）
- Site URL / Redirect URLs に `https://shadowwork-navigator.com` を追加
- テストユーザ作成（β検証用）
- API側でトークン検証に必要な情報を取得・保管
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - （必要なら）`SUPABASE_SERVICE_ROLE_KEY`
  - （検証方式に応じて）JWKSのURL/issuer/audience 等

##### AWS KMS（未着手 → 必須）
**実装方針（β）**: 非対称ラップを採用。クライアントで生成したDEKをKMS公開鍵でラップし、`wrapped_key*` としてAPIへ送る。

- AWSアカウントが無ければ作成（課金/権限/監査の前提）
- KMSの非対称鍵ペアを作成（用途: `ENCRYPT_DECRYPT`）
- 公開鍵取得（GetPublicKey）と `kid`（鍵識別子）運用を確定
- CloudTrailを有効化（KMS操作の監査ログ）
- IAMポリシーを作成
  - 公開鍵取得（GetPublicKey）の許可主体
  - 管理者用アンラップ（Decrypt）の許可主体（βでは最小人数/最小権限）

##### Qdrant（未着手 → 必須）
- Qdrantアカウント作成（Qdrant Cloud想定）
- Cluster作成（リージョン/プラン決定）
- API Key 発行
- Collection作成（embedding次元/距離関数）
- Workersから疎通できるURL/TLS要件を確認

#### インフラ前提（DNSは完了）
- ✅ DNSレコード設定（`shadowwork-navigator.com` / `api.shadowwork-navigator.com`）
- TLS（HTTPS）確認（Cookie運用のため必須）

- API: CORS allowlist を本番Originに合わせる（`ALLOWED_ORIGINS` に `https://shadowwork-navigator.com` を含める）
- API: `Access-Control-Allow-Origin` はリクエストOriginを **そのままエコー**（`*` は不可）
- API: `Access-Control-Allow-Credentials: true` を常に付与
- Web: fetch を `credentials: 'include'` に統一（`Set-Cookie` を受け取り、以後Cookie送信させる）
- API: `/api/auth/exchange` の `Set-Cookie` を点検（`Secure; HttpOnly; SameSite=Strict; Path=/`）
- Web: API_BASE を本番ドメインへ切替（ハードコードを廃止し、同一site想定で設定化）

#### Secrets/Vars（Cloudflare）
**狙い**: βの“未設定で詰まる”を防ぐため、最初に環境変数を棚卸しして登録する。

- API（Workers）
  - `ALLOWED_ORIGINS`（本番: `https://shadowwork-navigator.com`）
  - `JWT_SIGNING_SECRET`（自前JWT署名鍵）
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`（＋必要なら `SUPABASE_SERVICE_ROLE_KEY`）
  - `OPENAI_API_KEY`（embeddings/LLM用）
  - `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`
  - KMS連携用（方式確定後に追加）
    - `AWS_REGION`
    - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`（必要なら `AWS_SESSION_TOKEN`）
    - `KMS_KEY_ID`（`kid`と紐付け）
- Web（Pages）
  - Supabase（クライアント用）設定
  - API Base URL（本番: `https://api.shadowwork-navigator.com`）

#### Cloudflare / D1（必須）
- Workers（staging/production）の環境変数（vars）とSecretsが反映されていることを確認
- D1（staging/production）の binding が `DB` であることを確認（`wrangler.toml`）
- DDLの適用手順を確立
  - 開発環境は `apps/api/scripts/recreate-d1.ps1` を使用してD1再作成＋DDL適用（破壊的なので開発のみ）
  - staging/production は既存DBに対して安全にDDL差分を適用（破壊的操作はしない）

#### Stripe（設定済み：確認のみ）
- ✅ Stripeアカウント/商品/Checkout導線は設定済み
- Webhook が `https://api.shadowwork-navigator.com/api/stripe/webhook` に向いていることを確認
- `STRIPE_WEBHOOK_SECRET` がWorkers Secretsに登録済みであることを確認

**受入条件**
- ブラウザでログイン→exchange→以後の保護APIがCookie JWTで通る（403/401の挙動も仕様どおり）
- DevToolsで Cookie が `api.shadowwork-navigator.com` 宛リクエストに送信されている

### PR#2 認証移行（Supabase Auth → exchange）
**狙い**: Memberstack依存を外し、JWT（Cookie）でAPIが呼べる状態にする。

- API: `/api/auth/exchange` を Supabase JWT 検証に置換
- API: Secrets/Varsの棚卸し（MEMBERSTACK_* を撤去、SUPABASE_* を追加）
- API: Memberstack前提のチェックを削除（例: production時のキー形式ガード）
- Web: `user_id` クエリ送信を廃止（JWT由来に統一）

**受入条件**: ログイン→exchange→保護APIが200で通る（paid未満は403等が正しく出る）

### PR#3 カード機能の完全削除（API/DB/型/テスト/設計書）
**狙い**: `context_card` / `step2_meta_card` を完全撤去し、βの“文脈注入”をRAGへ一本化する。

- API: `/api/thread/context_card` と `/api/run/step2_meta_card` を削除（ルーティング含む）
- API: `thread/chat` からカード必須入力・カード注入を削除
- DB: `cards` テーブル/インデックスを DDL から削除
- types/tests/docs: カード関連を削除し、仕様を更新

**受入条件**: `thread/chat` がカード無しで200を返し、カードAPIが存在しない

### PR#4 封筒暗号（メッセージ保存の最小実装）
**狙い**: 本文を暗号文のみで保存し、復号に必要なメタ（wrapped_key* 含む）を扱える。

- API: `thread/message` / `thread/messages` を封筒暗号メタ対応に拡張（入出力契約の確定）
- API: wrapped_key* を **必須** として扱う（カード無し）
- API: KMS公開鍵の配布（例: `GET /api/crypto/kms_public_key`）
  - 返却: `kid` と公開鍵（PEM/JWK等、WebでRSA-OAEPラップできる形式）
- API: wrapped_key のアンラップ（例: `POST /api/crypto/dek/unseal`）
  - 用途: 履歴復号のために必要な場合のみ（βでは“本人操作のみ”に限定し、監査ログを必須化）
  - 実装: Workers → AWS KMS Decrypt（SigV4署名が必要）
  - 注意: 平文DEKは絶対にログへ出さない（メトリクス/例外も含む）
- API: AWS SigV4署名の実装（KMS呼び出し用）
- 運用: Decrypt（アンラップ）操作の監査メタを記録（操作者、理由、timestamp、対象thread/message等）
- D1: `database/DDL.sql` の封筒暗号メタカラムを適用（ローカル/ステージング）

**受入条件**: 1メッセージを暗号化して保存→履歴取得→復号して同一本文が表示できる

### PR#5 Web暗号実装（保存/表示/再読込）
**狙い**: UIが「暗号文API契約」に適合し、履歴が読める。

- Web: 暗号化（AES-GCM等）/復号実装
- Web: `thread/messages` の暗号文を復号して表示（平文前提の実装を修正）
- Web: 送信は `thread/chat`（LLM応答生成）→ 生成結果を含めて `thread/message` へ暗号化保存、に整理

**受入条件**: app/dashboardで履歴表示が成立（暗号文がそのまま見えない）

### PR#6 購入導線（Stripe Checkout）+ paid判定のUI統合
**狙い**: βで「購入→利用開始」が成立。

- Web: purchaseページをSupabaseログイン前提に更新
- API: Checkout Session作成をJWTのsubで確実に紐付け
- Web: `/api/paid` の反映、未paid時の導線（purchaseへ誘導）

**受入条件**: checkout→webhook→paid=true→run/startが通る

### PR#7 Qdrant接続（インフラ/設定/最小クライアント）
**狙い**: WorkersからQdrantへ安全に接続し、collectionを用意。

- Qdrant: 環境（Qdrant Cloud等）を確定、APIキー/TLSで接続
- API: Qdrantクライアント実装（upsert/searchの最小）
- API: env追加（QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION等）

**受入条件**: 開発環境で upsert/search が疎通する

### PR#8 チャンク保存（平文チャンク + embedding）
**狙い**: 本文暗号化と独立に、検索用チャンクをQdrantへ保存できる。

- Web→API: チャンクのアップサートAPI追加（例: `POST /api/rag/chunks`）
- API: embedding生成（OpenAI embeddings等）→ Qdrant upsert
- Qdrant payload: `user_id`, `thread_id`, `message_id`, `chunk_no`, `text`（平文チャンク）

**受入条件**: 送ったチャンクが検索でヒットし、メタでフィルタ可能

### PR#9 RAG注入（AIガイド最低限）
**狙い**: `/api/thread/chat` でQdrant検索結果（チャンク）をプロンプトに注入。

- API: クエリ埋め込み → Qdrant search → 上位Kチャンクを prompt/context に追加
- API: user_idで必ず絞り込み（他ユーザー混入を防ぐ）

**受入条件**: 既知の内容を含むチャンクが応答に反映される（精度はβ品質で可）

### PR#10 セキュリティ仕上げ + テスト/リリースチェック
**狙い**: 事故りやすい箇所をβ前に塞ぎ、リリースできる状態にする。

- API: ログ抑制（平文、チャンク平文、鍵素材を出さない）
- API: Rate limit / abuse対策（最低限）
- tests: integrationテストをSupabase/新契約に追従
- チェックリスト: βリリース手順（Workers/Pages/env/Stripe webhook/Qdrant/KMS）

**受入条件**: βリリースチェックリストが埋まり、再現性ある手順でデプロイできる

## 依存関係（ざっくり）
- PR#2 は PR#1 に依存（Cookie運用の成立）
- PR#5 は PR#4 に依存（暗号メタの契約が必要）
- PR#9 は PR#7/PR#8 に依存（Qdrantにデータが入る必要）

## βのDefinition of Done（最小）
- 認証: Supabaseでログインでき、Cookie JWTで保護APIが動く（同一site前提）
- 課金: 購入→paid反映→利用開始が成立
- 暗号: 本文はD1に暗号文のみ。復号して履歴表示できる（封筒暗号メタ含む）
- RAG: Qdrantにチャンクが入り、`/api/thread/chat` が検索結果を注入する
- カード: 仕様/実装/DBから完全に削除済み
- セキュリティ: CORS/credentials/Secrets/ログ抑制が設計どおり
