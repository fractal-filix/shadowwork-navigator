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

- [x] staging D1 binding が `DB` を向いている
- [x] staging D1 データベースが存在する
- [x] 必須テーブルが存在する
- [x] `messages` テーブルが存在する
- [x] `decrypt_audit_logs` テーブルが存在する
- [x] `stripe_webhook_events` テーブルが存在する
- [x] `user_flags` テーブルが存在する

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

- [x] staging テストでは Stripe test mode を使う方針である
- [x] `STRIPE_SECRET_KEY` が正しい
- [x] `STRIPE_WEBHOOK_SECRET` が正しい
- [x] `STRIPE_PRICE_ID` が正しい
- [x] `CHECKOUT_SUCCESS_URL` が正しい
- [x] `CHECKOUT_CANCEL_URL` が正しい
- [x] `STRIPE_CHECKOUT_MODE` が意図どおりである
- [x] webhook endpoint URL が staging API を向いている
- [x] `checkout.session.completed` を listen している
- [x] テスト決済に使うカード手段が確認できている

確認対象:
- Stripe Dashboard
- Workers staging secrets / vars

注意:
- staging では Stripe test mode を使い、production の live mode と取り違えない
- staging と production で webhook endpoint を取り違えない
- 現行実装では Checkout 戻り先の query 引数は使っていないため、`CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` は単純に購入ページへ戻す値を想定する
- production の想定値は `https://shadowwork-navigator.com/purchase.html`、staging の想定値は `https://web-staging.shadowwork-navigator.com/purchase.html` とする
- 確認済みの webhook endpoint URL は staging が `https://api-staging.shadowwork-navigator.com/api/stripe/webhook`、production が `https://api.shadowwork-navigator.com/api/stripe/webhook` である
- 成功系カード手段として `4242 4242 4242 4242` で Checkout 完了と dashboard 遷移を確認済み
- `STRIPE_PRICE_ID` には Product ID（`prod_...`）ではなく Price ID（`price_...`）を設定する

## 6. Qdrant

- [x] `QDRANT_URL` が正しい
- [x] `QDRANT_API_KEY` が正しい
- [x] `QDRANT_COLLECTION` が正しい
- [x] staging から HTTPS で疎通できる
- [x] 対象コレクションが存在する
- [x] `pnpm run verify:qdrant` 相当の確認結果が取れる

確認対象:
- Qdrant Cloud Console
- Workers staging vars / secrets
- `apps/api/scripts/verify-qdrant.mjs`

## 7. AWS KMS / STS

- [x] `AWS_REGION` が正しい
- [x] `AWS_ACCESS_KEY_ID` が正しい
- [x] `AWS_SECRET_ACCESS_KEY` が正しい
- [x] `KMS_KEY_ID` が正しい
- [x] `ASSUME_ROLE_ARN` が正しい
- [x] staging から KMS 公開鍵取得ができる
- [x] unseal 用 AssumeRole の設定値が揃っている

確認対象:
- AWS Console
- CloudTrail
- Workers staging secrets

注意:
- `AWS_KMS_BASE_URL` はモック用なので、実接続の staging では不要であることを確認する

確認手順メモ:
1. ここでは `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `KMS_KEY_ID` / `ASSUME_ROLE_ARN` が staging secrets に存在することまでを確認する
2. 実際の unseal 成功と CloudTrail 上の `AssumeRole` / `Decrypt` 記録確認は A-09 thread messages 復号で行う

## 8. OpenAI

- [x] `OPENAI_API_KEY` が登録されている
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
- [x] 課金済みユーザーを使える
- [ ] 必要なら再決済用のクリーンなユーザーを用意している
- [ ] テスト用ユーザーのメールアドレスと用途が整理されている

## 11. 実施開始条件

- [ ] 1 から 10 の未確認項目がない
- [ ] [test_plan.md](test_plan.md) の実施前チェックに進める
- [ ] 本番環境を誤って使わないことを確認した