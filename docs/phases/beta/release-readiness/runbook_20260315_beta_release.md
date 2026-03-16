# 2026.03.15 Runbook（βリリースチェックリスト）

このドキュメントは [../implementation/task.md](../implementation/task.md) の **2026.03.15 / 10.4** に対応する、βリリース当日の確認手順です。

対象:
- Workers
- Pages
- env / secrets / vars
- Stripe webhook
- Qdrant
- AWS KMS

判定基準:
- 事前確認、反映、反映後スモークの全項目が完了していること
- 本番URL `https://shadowwork-navigator.com` と API `https://api.shadowwork-navigator.com` で主要導線が成立すること

---

## 0. リリース前提

- [ ] リリース対象コミットが `main` に入っている
- [ ] 作業端末で Cloudflare / Stripe / Supabase / AWS へ必要な権限でログイン済み
- [ ] 機密情報を含む `.env*`, `.dev.vars`, 鍵ファイルを開いていない
- [ ] リリース作業ログの記録先を決めている（日時、実行者、結果、ロールバック判断）

補足:
- Web は `shadowwork-navigator.com`、API は `api.shadowwork-navigator.com` を前提にする
- preview URL は本番 Cookie 運用の確認には使わない

---

## 1. ローカル最終確認

作業ディレクトリ: リポジトリルート

```powershell
pnpm install --frozen-lockfile
pnpm --filter ./apps/api test
pnpm --filter ./apps/web test
pnpm build
```

チェック:
- [ ] `apps/api` のテストが成功する
- [ ] `apps/web` のテストが成功する
- [ ] `pnpm build` が成功する

補足:
- `apps/web` のテストは Windows 互換のため `node --test tests` を使う実装になっている
- `apps/api` の deploy 前ビルドは `pnpm run build` 相当でよい

---

## 2. Workers 本番前チェック

作業ディレクトリ: `apps/api`

### 2.1 vars の確認

`apps/api/wrangler.toml` の `env.staging.vars` / `env.production.vars` を確認する。

- [ ] `APP_ENV`
- [ ] `ALLOWED_ORIGINS=https://shadowwork-navigator.com`
- [ ] `JWT_ISSUER`
- [ ] `JWT_AUDIENCE`
- [ ] `ACCESS_TOKEN_TTL_SECONDS`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_JWKS_URL`
- [ ] `SUPABASE_ISSUER`
- [ ] `SUPABASE_AUDIENCE`
- [ ] `QDRANT_URL`
- [ ] `QDRANT_COLLECTION`

Stripe 導線で追加確認が必要な vars:
- [ ] `CHECKOUT_SUCCESS_URL`
- [ ] `CHECKOUT_CANCEL_URL`
- [ ] `STRIPE_CHECKOUT_MODE`（未設定時は `payment`）

### 2.2 secrets の確認

```powershell
cd apps/api
pnpm exec wrangler secret list --env staging
pnpm exec wrangler secret list --env production
```

- [ ] `JWT_SIGNING_SECRET`
- [ ] `OPENAI_API_KEY`
- [ ] `QDRANT_API_KEY`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `STRIPE_PRICE_ID`
- [ ] `PAID_ADMIN_TOKEN`
- [ ] `ADMIN_MEMBER_IDS`
- [ ] `AWS_REGION`
- [ ] `AWS_ACCESS_KEY_ID`
- [ ] `AWS_SECRET_ACCESS_KEY`
- [ ] `KMS_KEY_ID`
- [ ] `ASSUME_ROLE_ARN`

補足:
- `wrangler secret list` の表示で先頭スペース付きに見えても、Cloudflare Dashboard の実値確認を優先する
- `AWS_SESSION_TOKEN` は任意。`ASSUME_ROLE_ARN` 運用なら未設定でも可

### 2.3 D1 binding とスキーマ確認

- [ ] `wrangler.toml` の binding が staging / production ともに `DB`

必要なら本番前に確認:

```powershell
cd apps/api
pnpm exec wrangler d1 execute filix_shadowwork_stg --env staging --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
pnpm exec wrangler d1 execute filix_shadowwork_prod --env production --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
pnpm exec wrangler d1 execute filix_shadowwork_prod --env production --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages','decrypt_audit_logs','stripe_webhook_events') ORDER BY name;"
```

- [ ] `messages`
- [ ] `decrypt_audit_logs`
- [ ] `stripe_webhook_events`

---

## 3. Pages 本番前チェック

参照:
- ルート設定は `README.md`
- 特商法ページの環境変数は `apps/web/functions/tokushoho.html.ts`
- Web クライアント設定の参照先は `apps/web/pages/lib/client.js`

Cloudflare Pages 側で確認:
- [ ] Production ドメインが `https://shadowwork-navigator.com`
- [ ] Pages URL が `https://shadowwork-navigator.pages.dev`
- [ ] Root directory が `apps/web`
- [ ] Output directory が `pages`

特商法ページの環境変数:
- [ ] `TOKUSHOHO_RESPONSIBLE_NAME`
- [ ] `TOKUSHOHO_PHONE`
- [ ] `TOKUSHOHO_ADDRESS`（任意だが本番実値推奨）
- [ ] `TOKUSHOHO_EMAIL`（任意だが本番実値推奨）

Web クライアント設定:
- [ ] 本番ページ読み込み時に `SHADOWNAV_API_BASE` が `https://api.shadowwork-navigator.com` を指す
- [ ] 本番ページ読み込み時に `SHADOWNAV_SUPABASE_URL` が設定されている
- [ ] 本番ページ読み込み時に `SHADOWNAV_SUPABASE_PUBLISHABLE_KEY` が設定されている

補足:
- 現在の Web は `apps/web/pages/lib/client.js` で `globalThis.SHADOWNAV_*` または `localStorage` を参照する
- 本番確認では `index.html` に「Supabase 設定が不足しています」が出ないことを必須条件にする

---

## 4. Stripe webhook 確認

Stripe Dashboard と Workers の両方で確認する。

Dashboard:
- [ ] endpoint URL が `https://api.shadowwork-navigator.com/api/stripe/webhook`
- [ ] listen events に `checkout.session.completed` が含まれている

Workers 側:
- [ ] production に `STRIPE_WEBHOOK_SECRET` が登録済み
- [ ] production に `STRIPE_SECRET_KEY` と `STRIPE_PRICE_ID` が登録済み

疎通確認:

```powershell
curl --ssl-no-revoke -i -X POST https://api.shadowwork-navigator.com/api/stripe/webhook
```

- [ ] `400` かつ `missing Stripe-Signature` 相当で応答する

---

## 5. Qdrant 確認

作業ディレクトリ: `apps/api`

本番相当の secure な値を一時環境変数へ投入して確認する。

```powershell
cd apps/api
$env:QDRANT_URL = "https://<cluster>.<region>.qdrant.cloud"
$env:QDRANT_API_KEY = "<qdrant_api_key>"
$env:QDRANT_COLLECTION = "<collection_name>"
pnpm run verify:qdrant
```

- [ ] `Qdrant connectivity check: OK`
- [ ] `tls: https`
- [ ] `QDRANT_COLLECTION` が `found`

補足:
- 実値は secure な保管先から都度取得し、シェル履歴やドキュメントへ残さない

---

## 6. AWS KMS 確認

production secrets と API の両方で確認する。

Secrets:
- [ ] `AWS_REGION`
- [ ] `AWS_ACCESS_KEY_ID`
- [ ] `AWS_SECRET_ACCESS_KEY`
- [ ] `KMS_KEY_ID`
- [ ] `ASSUME_ROLE_ARN`

公開鍵配布のスモーク:

```powershell
curl --ssl-no-revoke https://api.shadowwork-navigator.com/api/crypto/kms_public_key
```

- [ ] `200 OK`
- [ ] レスポンス JSON に `kid` が含まれる
- [ ] レスポンス JSON に `public_key_pem` が含まれる

補足:
- `GET /api/crypto/kms_public_key` は認証不要
- `POST /api/crypto/dek/unseal` は paid ユーザーかつ本人操作前提のため、公開 API だけでなく Web 履歴復号で実確認する
- KMS の監査は CloudTrail 側でも確認可能にしておく

---

## 7. 本番反映手順

### 7.1 API（Workers）

```powershell
cd apps/api
pnpm run build
pnpm exec wrangler deploy --env staging
pnpm exec wrangler deploy --env production
```

- [ ] staging deploy 成功
- [ ] production deploy 成功

### 7.2 Web（Pages）

- [ ] 本番対象コミットが `main` に反映済み
- [ ] Cloudflare Pages の production deploy が対象コミットまで進んでいる
- [ ] `https://shadowwork-navigator.com` が最新コミットを配信している

補足:
- このリポジトリには Web の専用 deploy コマンドを置いていないため、Pages の Git 連携または Dashboard 上の production deploy 状態を正とする

---

## 8. 反映後スモークテスト

### 8.1 基本疎通

- [ ] `https://shadowwork-navigator.com` が表示できる
- [ ] `https://api.shadowwork-navigator.com/` が応答する
- [ ] `https://shadowwork-navigator.com/tokushoho.html` が表示できる

### 8.2 認証と Cookie

- [ ] `index.html` で Supabase ログインできる
- [ ] ログイン後、`dashboard.html` へ遷移できる
- [ ] ブラウザ DevTools で `api.shadowwork-navigator.com` 宛リクエストに Cookie が送られている
- [ ] CORS 応答に `Access-Control-Allow-Credentials: true` が含まれる

### 8.3 購入導線

- [ ] `purchase.html` で未ログイン時にログイン導線が出る
- [ ] ログイン後に `決済ページへ` が有効になる
- [ ] Stripe Checkout を開始できる
- [ ] 支払い後に `支払い確認` で paid 状態を反映できる

### 8.4 履歴・暗号・KMS

- [ ] `dashboard.html` で履歴一覧を取得できる
- [ ] 既存 thread の `thread/messages` が復号表示される
- [ ] 復号失敗時に平文鍵素材が画面やログへ露出しない

### 8.5 RAG / Qdrant

- [ ] 新規メッセージ送信後、RAG 用 chunk 保存が失敗していない
- [ ] 既知チャンクを含む問い合わせで関連文脈が応答に反映される

---

## 9. リリース完了記録

- [ ] 実施日時
- [ ] 実施者
- [ ] 反映した commit SHA
- [ ] staging / production の結果
- [ ] 既知の残課題
- [ ] ロールバック要否

記録例:

```text
2026-03-15 21:30 JST / <name>
- commit: <sha>
- workers: staging/prod ok
- pages: prod ok
- stripe webhook: ok
- qdrant: ok
- kms_public_key: ok
- smoke: login / purchase / dashboard history ok
```