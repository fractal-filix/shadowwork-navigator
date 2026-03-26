# β版 staging 事前準備チェックリスト

このチェックリストは、staging で結合テストを始める前に、外部サービスと周辺設定が利用可能な状態かを確認するためのものです。

目的:
- staging 結合テスト開始前の前提不足を潰す
- 実装不具合と環境不備を切り分けやすくする
- 外部サービス依存の初期詰まりを減らす

## 1. Workers staging

- [x] staging Worker の URL が分かっている
- [x] staging Worker へ到達できる
- [x] `APP_ENV=staging` になっている
- [x] `ALLOWED_ORIGINS` が staging テストで使う origin と整合している
- [x] `JWT_ISSUER` / `JWT_AUDIENCE` / `ACCESS_TOKEN_TTL_SECONDS` が設定されている

確認対象:
- `apps/api/wrangler.toml`
- Cloudflare Workers の staging 環境設定

注意:
- staging のブラウザ結合テストは固定 origin（`https://web-staging.shadowwork-navigator.com`）を入口にする
- `ALLOWED_ORIGINS` は上記固定 origin のみに合わせる
- preview URL（`*.pages.dev`）は結合テスト入口として使わない
- どうしても preview URL を使う場合は一時運用とし、対象の origin 1件だけを allowlist に追加する（ワイルドカード禁止）

## 2. D1 staging

- [ ] staging D1 binding が `DB` を向いている
- [ ] staging D1 データベースが存在する
- [ ] 必須テーブルが存在する
- [ ] `messages` テーブルが存在する
- [ ] `decrypt_audit_logs` テーブルが存在する
- [ ] `stripe_webhook_events` テーブルが存在する
- [ ] `user_flags` テーブルが存在する

確認対象:
- `wrangler.toml`
- `wrangler d1 execute ... --env staging --remote`

## 3. Web の staging 接続設定

- [x] staging テストで使う Web の入口が決まっている
- [x] `SHADOWNAV_API_BASE` を staging API に向ける方法が決まっている
- [x] `SHADOWNAV_SUPABASE_URL` が設定できる
- [x] `SHADOWNAV_SUPABASE_PUBLISHABLE_KEY` が設定できる
- [x] Cookie を送る前提で API 通信できる
- [x] 誤って本番 API を叩かない運用になっている

確認対象:
- `apps/web/pages/lib/client.js`
- `apps/web/README.md`

注意:
- 既定の API Base は本番 URL なので、staging テスト時の上書き方法を明示しておく

## 4. Supabase Auth

- [x] staging テストで使う Supabase Project が決まっている
- [x] テストユーザーをログインに使える
- [x] Email/Password ログインが有効
- [x] `SUPABASE_URL` が正しい
- [x] `SUPABASE_JWKS_URL` が正しい
- [x] `SUPABASE_ISSUER` が正しい
- [x] `SUPABASE_AUDIENCE` が正しい
- [x] Web 用の `SHADOWNAV_SUPABASE_URL` が正しい
- [x] Web 用の `SHADOWNAV_SUPABASE_PUBLISHABLE_KEY` が正しい
- [x] auth exchange 後に API Cookie を張れる

確認対象:
- Supabase Dashboard
- Workers vars / secrets
- Web の localStorage 上書きまたは staging 注入設定

## 5. Stripe

- [ ] staging テストで使う Stripe アカウントまたは mode が決まっている
- [ ] `STRIPE_SECRET_KEY` が正しい
- [ ] `STRIPE_WEBHOOK_SECRET` が正しい
- [ ] `STRIPE_PRICE_ID` が正しい
- [ ] `CHECKOUT_SUCCESS_URL` が正しい
- [ ] `CHECKOUT_CANCEL_URL` が正しい
- [ ] `STRIPE_CHECKOUT_MODE` が意図どおりである
- [ ] webhook endpoint URL が staging API を向いている
- [ ] `checkout.session.completed` を listen している
- [ ] テスト決済に使うカード手段が確認できている

確認対象:
- Stripe Dashboard
- Workers staging secrets / vars

注意:
- staging と production で webhook endpoint を取り違えない

## 6. Qdrant

- [ ] `QDRANT_URL` が正しい
- [ ] `QDRANT_API_KEY` が正しい
- [ ] `QDRANT_COLLECTION` が正しい
- [ ] staging から HTTPS で疎通できる
- [ ] 対象コレクションが存在する
- [ ] `pnpm run verify:qdrant` 相当の確認結果が取れる

確認対象:
- Qdrant Cloud Console
- Workers staging vars / secrets
- `apps/api/scripts/verify-qdrant.mjs`

## 7. AWS KMS / STS

- [ ] `AWS_REGION` が正しい
- [ ] `AWS_ACCESS_KEY_ID` が正しい
- [ ] `AWS_SECRET_ACCESS_KEY` が正しい
- [ ] `KMS_KEY_ID` が正しい
- [ ] `ASSUME_ROLE_ARN` が正しい
- [ ] staging から KMS 公開鍵取得ができる
- [ ] staging から unseal のための AssumeRole ができる
- [ ] decrypt 実行時の監査を CloudTrail で追える

確認対象:
- AWS Console
- CloudTrail
- Workers staging secrets

注意:
- `AWS_KMS_BASE_URL` はモック用なので、実接続の staging では不要であることを確認する

## 8. OpenAI

- [ ] `OPENAI_API_KEY` が正しい
- [ ] 必要なら `OPENAI_API_BASE_URL` が正しい
- [ ] thread chat 用の応答生成ができる
- [ ] embeddings 生成ができる
- [ ] レート制限や課金停止などで即時失敗しない

確認対象:
- OpenAI 側の利用状況
- Workers staging secrets / vars

## 9. 管理画面アクセス

- [ ] Cloudflare Dashboard に入れる
- [ ] Supabase Dashboard に入れる
- [ ] Stripe Dashboard に入れる
- [ ] Qdrant Console に入れる
- [ ] AWS Console / CloudTrail に入れる

目的:
- fail 時に「環境のせいか」をすぐ切り分けられるようにする

## 10. テストユーザー

- [x] 未課金ユーザーを使える
- [ ] 課金済みユーザーを使える
- [ ] 必要なら再決済用のクリーンなユーザーを用意している
- [ ] テスト用ユーザーのメールアドレスと用途が整理されている

## 11. 実施開始条件

- [ ] 1 から 10 の未確認項目がない
- [ ] [test_plan.md](test_plan.md) の実施前チェックに進める
- [ ] 本番環境を誤って使わないことを確認した