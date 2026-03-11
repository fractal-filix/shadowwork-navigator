# タスク一覧

作成日: 2026-02-28

- 合計: 237pt
- 対象: docs/sprint-plan.md の（0pt除外）
- 日割りの考え方: 2026/03/01〜03/15 の15日で均等割り（237/15=15.8 → 切り上げ16pt/日）し、累計閾値（16, 32, 48...）を超えるタスクは前日側に残す（前詰め）。

> 注: 本ファイルは「日付＝実行順」で並べる（依存関係で前後しない）前提。

## 2026.03.01
- [x] 1.4.2 TLS（HTTPS）確認（Cookie運用のため必須）（1pt）
- [x] 1.4.3 API: CORS allowlist を本番Originに合わせる（ALLOWED_ORIGINS に https://shadowwork-navigator.com）（1pt）
- [x] 1.4.4 API: Access-Control-Allow-Origin をOriginエコーにする（*不可）（2pt）
- [x] 1.4.5 API: Access-Control-Allow-Credentials: true を常に付与（1pt）
- [x] 1.4.6 Web: fetch を credentials: 'include' に統一（2pt）
- [x] 1.4.7 API: /api/auth/exchange の Set-Cookie を点検（Secure; HttpOnly; SameSite=Strict; Path=/）（2pt）
- [x] 1.4.8 Web: API Base URL を https://api.shadowwork-navigator.com 前提に設定化（2pt）

- [x] 1.5.1 API（Workers）: Secrets/Vars の棚卸しと登録（3pt）
- [x] 1.5.1.1 ALLOWED_ORIGINS を登録（1pt）
- [x] 1.5.1.2 JWT_SIGNING_SECRET を登録（2pt）

## 2026.03.02
- [-] 1.5.1.8 staging に ADMIN_MEMBER_IDS を登録（secret list 棚卸しで未登録）（1pt）※Memberstack廃止予定のため実行スキップ（記録のみ）。 2.2（MEMBERSTACK_* 撤去）で回収予定
- [x] 1.6.2 D1（staging/production）の binding が DB であることを確認（wrangler.toml）（1pt）
- [x] 1.7.2 Webhook が https://api.shadowwork-navigator.com/api/stripe/webhook に向いていることを確認（1pt）
	- 手順: docs/sprints/sprint1/runbook_20260302.md
	- 実装側の根拠: apps/api/src/worker.ts で `POST /api/stripe/webhook` をルーティング済み
	- 到達性: `curl --ssl-no-revoke -i -X POST https://api.shadowwork-navigator.com/api/stripe/webhook` で 400（missing Stripe-Signature）を確認
- [x] 1.7.3 STRIPE_WEBHOOK_SECRET がWorkers Secretsに登録済みであることを確認（1pt）
	- 手順: docs/sprints/sprint1/runbook_20260302.md
- [x] 1.1.1 Supabaseアカウント作成（1pt）
- [x] 1.1.2 Project作成（リージョン/プラン決定）（2pt）
- [x] 1.1.3 Auth有効化（Email+Password）（2pt）
    - テストユーザーでログイン確認済
    - smtp未設定
- [x] 1.1.4 Site URL / Redirect URLs に https://shadowwork-navigator.com を追加（1pt）
- [x] 1.1.5 テストユーザ作成（β検証用）（1pt）
- [x] 1.1.6 API側でトークン検証に必要な情報を取得・保管（3pt）
    - SUPABASE_URL検証用スクリプト：apps\api\scripts\verify-jwt.mjs ※JWTの署名等を検証する中でurlも検証
- [x] 1.1.6.1 SUPABASE_URL を取得（1pt）
	- 手順: docs/sprints/sprint1/runbook_20260302.md

## 2026.03.03
- [x] 1.1.6.2 SUPABASE_ANON_KEY を取得（1pt）
- [x] 1.1.6.3 （必要なら）SUPABASE_SERVICE_ROLE_KEY を取得（2pt）
- [x] 1.1.6.4 （検証方式に応じて）JWKSのURL/issuer/audience 等を確定（3pt）
	- 確定値: `SUPABASE_JWKS_URL` / `SUPABASE_ISSUER` / `SUPABASE_AUDIENCE=authenticated`
	- 反映: `apps/api/wrangler.toml`, `apps/api/src/types/env.ts`, `apps/api/scripts/verify-jwt.mjs`
- [x] 1.5.1.3 SUPABASE_URL, SUPABASE_ANON_KEY を登録（1pt）
- [x] 1.5.1.4 （必要なら）SUPABASE_SERVICE_ROLE_KEY を登録（2pt）
- [x] 1.5.2 Web（Pages）: 設定の反映（2pt）
- [x] 1.5.2.1 Supabase（クライアント用）設定を登録（2pt）
	- `apps/web/pages/lib/client.js` に `SHADOWNAV_SUPABASE_URL` / `SHADOWNAV_SUPABASE_ANON_KEY` を追加
- [x] 1.5.2.2 API Base URL（本番: https://api.shadowwork-navigator.com）を登録（1pt）
	- `apps/web/pages/lib/client.js` の既定値を維持、`apps/web/README.md` に反映手順を追記
- [x] 1.6.1 Workers（staging/production）のVars/Secrets反映を確認（2pt）
	- 確認手順を `docs/sprints/sprint1/runbook_20260302.md` に追記（実環境での `wrangler secret list` 実行は未実施）

## 2026.03.04
- [x] 1.2.1 AWSアカウントが無ければ作成（課金/権限/監査の前提）（2pt）
- [x] 1.2.2 KMSの非対称鍵ペアを作成（用途: ENCRYPT_DECRYPT）（4pt）
	- 手順: docs/sprints/sprint1/runbook_20260304.md
- [x] 1.2.3 公開鍵取得（GetPublicKey）と kid（鍵識別子）運用を確定（3pt）
	- 手順: docs/sprints/sprint1/runbook_20260304.md
	- kid（暫定案）: KMS KeyId を `kid` として扱う（運用を単純化）
- [x] 1.2.4 CloudTrailを有効化（KMS操作の監査ログ）（2pt）
	- 手順: docs/sprints/sprint1/runbook_20260304.md
- [x] 1.2.5 IAMポリシーを作成（4pt）
	- 雛形: docs/sprints/sprint1/aws/iam/kms_get_public_key_policy.json
	- 手順: docs/sprints/sprint1/runbook_20260304.md
- [x] 1.2.5.1 公開鍵取得（GetPublicKey）の許可主体を確定（2pt）
	- 結論（まずの案）: Workers 実行主体の AWS 資格情報のみ許可（一般ユーザー/開発者個人は原則不可）
	- 手順: docs/sprints/sprint1/runbook_20260304.md

## 2026.03.05
- [x] 1.2.5.2 管理者用アンラップ（Decrypt）の許可主体を確定（3pt）
	- 手順: docs/sprints/sprint1/runbook_20260305.md
	- 結論: GetPublicKey と Decrypt の許可主体（Role）を分離
	- 雛形: docs/sprints/sprint1/aws/iam/kms_decrypt_admin_policy.json, kms_decrypt_workers_policy.json, kms_decrypt_workers_trust_policy.json
- [x] 1.3.1 Qdrantアカウント作成（Qdrant Cloud想定）（1pt）
	- runbook: docs/sprints/sprint1/runbook_20260305_qdrant.md を参照し、アカウント/クラスタ/APIキー/コレクションを作成して下さい。
- [x] 1.3.2 Cluster作成（リージョン/プラン決定）（2pt）
- [x] 1.3.3 API Key 発行（1pt）
- [x] 1.3.4 Collection作成（embedding次元/距離関数）（3pt）
- [x] 1.3.5 Workersから疎通できるURL/TLS要件を確認（2pt）
	- 確認結果: `curl.exe --ssl-no-revoke -i "$env:QDRANT_URL/collections" -H "api-key: $env:QDRANT_API_KEY"` で 200 OK と collection 一覧を確認
- [x] 1.5.1.5 OPENAI_API_KEY を登録（2pt）
- [x] 1.5.1.6 QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION を登録（2pt）

## 2026.03.06
- [x] 1.5.1.7 KMS連携用のAWS資格情報/設定を登録（3pt）
	- 確認手順: `cd apps/api && pnpm exec wrangler secret list --env staging && pnpm exec wrangler secret list --env production`
	- 確認結果: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `KMS_KEY_ID` を staging/production 両方で確認
	- 補足: `ASSUME_ROLE_ARN` も staging/production 両方で確認（`dek_unseal` 実装の必須設定）
- [x] 1.5.1.7.1 AWS_REGION（1pt）
- [x] 1.5.1.7.2 AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY（2pt）
- [-] 1.5.1.7.3 （必要なら）AWS_SESSION_TOKEN（1pt）※現時点は未登録。`ASSUME_ROLE_ARN` で運用可能なため任意スキップ（必要時に追加）
- [x] 1.5.1.7.4 KMS_KEY_ID（2pt）
	- 補足: Cloudflare Dashboard（Web UI）で目視確認し、secret 名の先頭スペースは無し（CLI出力上の見え方による誤認としてクローズ）。

- [x] 1.6.3 DDLの適用手順を確立（3pt）
	- 手順書: `docs/sprints/sprint1/runbook_20260306.md`
	- 実施（2026-03-08）: pre-release 前提で staging/production を破壊的再作成し、`database/DDL.sql` を `--remote` で適用
- [x] 1.6.3.1 開発環境: apps/api/scripts/recreate-d1.ps1 でD1再作成＋DDL適用（破壊的なので開発のみ）（2pt）
	- 実行コマンドと確認コマンドを runbook に固定化
- [x] 1.6.3.2 staging/production: 既存DBへ安全にDDL差分を適用（破壊的操作はしない）（4pt）
	- `wrangler d1 execute --file` での非破壊差分適用フロー（staging→production）を runbook に固定化
	- 実施（2026-03-08）: `pnpm exec wrangler d1 execute filix_shadowwork_stg --env staging --remote --file database/DDL.sql`
	- 実施（2026-03-08）: `pnpm exec wrangler d1 execute filix_shadowwork_prod --env production --remote --file database/DDL.sql`
	- 検証（remote）: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;` で `runs`, `threads`, `messages`, `cards`, `user_flags`, `stripe_webhook_events` を確認

## 2026.03.07
- [x] 2.1 API: /api/auth/exchange を Supabase JWT 検証に置換（4pt）
- [x] 2.2 API: Secrets/Varsの棚卸し（MEMBERSTACK_* 撤去、SUPABASE_* 追加）（2pt）
- [x] 2.2.1 Web: Memberstack スクリプト削除と Supabase クライアント置換（4pt）
- [x] 2.2.2 Docs: 設計書内の Memberstack 記述を Supabase に置換（2pt）
- [x] 2.3 API: Memberstack前提のチェックを削除（例: production時のキー形式ガード）（2pt）
- [x] 2.4 Web: user_id クエリ送信を廃止（JWT由来に統一）（3pt）
- [x] 3.1 API: /api/thread/context_card と /api/run/step2_meta_card を削除（ルーティング含む）（3pt）

## 2026.03.08
- [x] 3.2 API: thread/chat からカード必須入力・カード注入を削除（3pt）
- [x] 3.3 DB: cards テーブル/インデックスを DDL から削除（3pt）
- [x] 3.4 types/tests/docs: カード関連を削除し、仕様を更新（4pt）
- [x] 4.1 API: thread/message / thread/messages を封筒暗号メタ対応に拡張（入出力契約の確定）（5pt）

## 2026.03.09
- [x] 4.2 API: wrapped_key* を **必須** として扱う（カード無し）（3pt）
- [x] 4.3 API: KMS公開鍵の配布（例: GET /api/crypto/kms_public_key）（4pt）
- [x] 4.3.1 返却: kid と公開鍵（PEM/JWK等、WebでRSA-OAEPラップできる形式）（3pt）
- [x] 4.4 API: wrapped_key のアンラップ（例: POST /api/crypto/dek/unseal）（6pt）

## 2026.03.10
- [x] 4.4.1 用途/権限制御を確定（βでは“本人操作のみ”、監査ログ必須）（4pt）
- [x] 4.4.2 実装: Workers → AWS KMS Decrypt（SigV4署名）（5pt）
- [x] 4.4.3 注意: 平文DEKをログへ出さない（メトリクス/例外も含む）（2pt）
- [x] 4.5 API: AWS SigV4署名の実装（KMS呼び出し用）（7pt）
	- 検証: `GET /api/crypto/kms_public_key` と `POST /api/crypto/dek/unseal` の統合テストで、KMS/STS への `AWS4-HMAC-SHA256` Authorization, `x-amz-date`, `x-amz-content-sha256`, `x-amz-security-token` を確認

## 2026.03.11
- [x] 4.6 運用: Decrypt（アンラップ）操作の監査メタを記録（操作者、理由、timestamp、対象thread/message等）（4pt）
- [x] 4.7 D1: database/DDL.sql の封筒暗号メタカラムを適用（ローカル/ステージング）（3pt）
	- 実施（local）: `pwsh -File scripts/recreate-d1.ps1 -DatabaseName filix_shadowwork_dev -Binding DB -DeleteExisting`
	- 実施（staging）: `pnpm exec wrangler d1 execute filix_shadowwork_stg --env staging --remote --file database/DDL.sql`
	- 実施（production）: `pnpm exec wrangler d1 execute filix_shadowwork_prod --env production --remote --file database/DDL.sql`
	- 検証（local/staging/production）: `PRAGMA table_info(messages);` で `content_wrapped_key`, `content_wrapped_key_alg`, `content_wrapped_key_kid`, `content_key_v` を確認し、`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages','decrypt_audit_logs') ORDER BY name;` で `decrypt_audit_logs` を確認
	- 補足: staging の破壊的再作成は `wrangler d1 delete ... --env staging` が `fetch failed` で不安定だったため、pre-release 前提で DDL 再適用に切り替えて反映
- [ ] 5.1 Web: 暗号化（AES-GCM等）/復号実装（6pt）
- [ ] 5.2 Web: thread/messages の暗号文を復号して表示（平文前提の実装を修正）（4pt）

## 2026.03.12
- [ ] 5.3 Web: 送信フロー整理（thread/chat → thread/message に暗号化保存）（5pt）
- [ ] 6.1 Web: purchaseページをSupabaseログイン前提に更新（3pt）
- [ ] 6.2 API: Checkout Session作成をJWTのsubで確実に紐付け（3pt）
- [ ] 6.3 Web: /api/paid の反映、未paid時の導線（purchaseへ誘導）（2pt）

## 2026.03.13
- [ ] 7.1 Qdrant: 環境（Qdrant Cloud等）を確定、APIキー/TLSで接続（3pt）
- [ ] 7.2 API: Qdrantクライアント実装（upsert/searchの最小）（5pt）
- [ ] 7.3 API: env追加（QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION等）（2pt）
- [ ] 8.1 Web→API: チャンクのアップサートAPI追加（例: POST /api/rag/chunks）（4pt）
- [ ] 8.2 API: embedding生成（OpenAI embeddings等）→ Qdrant upsert（5pt）

## 2026.03.14
- [ ] 8.3 Qdrant payload仕様を確定（user_id, thread_id, message_id, chunk_no, text 等）（3pt）
- [ ] 9.1 API: クエリ埋め込み → Qdrant search → 上位Kチャンクを prompt/context に追加（6pt）
- [ ] 9.2 API: user_idで必ず絞り込み（他ユーザー混入を防ぐ）（3pt）
- [ ] 10.1 API: ログ抑制（平文、チャンク平文、鍵素材を出さない）（3pt）

## 2026.03.15
- [ ] 10.2 API: Rate limit / abuse対策（最低限）（4pt）
- [ ] 10.3 tests: integrationテストをSupabase/新契約に追従（4pt）
- [ ] 10.4 チェックリスト: βリリース手順（Workers/Pages/env/Stripe webhook/Qdrant/KMS）（3pt）
