filix-shadowwork-api

概要
------
このリポジトリは Filix Shadowwork API サービスのバックエンド実装です。

環境変数とシークレットの管理
-----------------------------

概要: 実際の値（機密情報）はリポジトリに含めず、環境ごとに安全に管理してください。

推奨運用:
- 機密情報（シークレット）
	- 例: `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
	- 管理方法: Cloudflare Workers のシークレット（`wrangler secret put`）または Cloudflare ダッシュボードの Secrets に登録

- 非機密設定（vars）
	- 例: `OPENAI_API_BASE_URL`, `STRIPE_API_BASE_URL`, `STRIPE_CHECKOUT_MODE`, `CHECKOUT_SUCCESS_URL`
	- 管理方法: `wrangler.toml` の `[vars]` または Cloudflare ダッシュボードの環境変数（vars）に設定

- ローカル開発
	- `.dev.vars` のようなローカル専用ファイルを使用して開発用の値を管理してください。`.dev.vars` は必ず `.gitignore` に入れ、リポジトリへコミットしないでください。

設定例
1. シークレット登録（wrangler）

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

2. `wrangler.toml` に非機密 vars を置く例

```toml
[vars]
OPENAI_API_BASE_URL = "https://api.openai.com"
STRIPE_API_BASE_URL  = "https://api.stripe.com"
STRIPE_CHECKOUT_MODE  = "payment"
```

実装上の注意
- `src/types/env.ts` に環境変数の型が定義されています。コードは必ず `env.VAR` を参照してください。
- 開発用ショートカット（例: `X-TEST-MEMBER-ID` によるテスト用なりすまし）は `APP_ENV=test` の場合のみ有効にするなど、環境で挙動を切り替える運用をしてください。
- `POST /api/checkout/session` は `member_id`（JWTの`sub`）を `mem_` 形式として検証し、Stripe Checkout には `mode=payment` と `client_reference_id=<member_id>` を付与します。

CORS/Cookie 運用の必須設定
- `ALLOWED_ORIGINS` は許可する Origin のみを設定する（`*` 不可）。
- CORS は許可 Origin をエコーし、`Access-Control-Allow-Credentials: true` を返す。
- `/api/auth/exchange` の `Set-Cookie` は `HttpOnly; Secure; SameSite=Strict; Path=/` を維持する。

棚卸し手順（Workers: staging / production）
-------------------------------------------

3/1時点の運用に合わせ、以下の手順で Secrets/Vars を棚卸しします。

1. Secrets 一覧を確認

```bash
pnpm exec wrangler secret list --env staging
pnpm exec wrangler secret list --env production
```

2. Vars は `wrangler.toml` の `[env.<name>.vars]` を確認

必須 Vars（3/1時点）:
- `APP_ENV`
- `ALLOWED_ORIGINS`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `ACCESS_TOKEN_TTL_SECONDS`

必須 Secrets（3/1時点）:
- `ADMIN_MEMBER_IDS`
- `JWT_SIGNING_SECRET`
- `MEMBERSTACK_SECRET_KEY`
- `OPENAI_API_KEY`
- `PAID_ADMIN_TOKEN`
- `STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

登録コマンド例:

```bash
pnpm exec wrangler secret put ADMIN_MEMBER_IDS --env staging
pnpm exec wrangler secret put ADMIN_MEMBER_IDS --env production
```

ドキュメント追記希望があれば、`.env.example` の追加やデプロイ手順のテンプレートも作成します。

D1再作成の自動化（PowerShell）
--------------------------------

`scripts/recreate-d1.ps1` は以下を自動実行します。
- D1作成（必要なら削除して再作成）
- `database/DDL.sql` の適用
- `wrangler.toml` の `[[d1_databases]]`（指定 binding）の `database_name` / `database_id` 更新

実行例:

```powershell
# 既存DBを削除して作り直し（推奨: 開発環境のみ）
pwsh -File scripts/recreate-d1.ps1 -DatabaseName filix_shadowwork_dev -DeleteExisting

# binding名を明示する場合
pwsh -File scripts/recreate-d1.ps1 -DatabaseName filix_shadowwork_dev -Binding DB -DeleteExisting

# wranglerの環境を使う場合（例: --env staging）
pwsh -File scripts/recreate-d1.ps1 -DatabaseName filix_shadowwork_stg -Environment staging -DeleteExisting
```

主な引数:
- `-DatabaseName`（必須）: 作成するD1データベース名
- `-Binding`（省略可、既定: `DB`）: `wrangler.toml` の D1 binding 名
- `-DdlPath`（省略可、既定: `database/DDL.sql`）
- `-WranglerTomlPath`（省略可、既定: `wrangler.toml`）
- `-Environment`（省略可）: `wrangler --env <name>` を付与
- `-DeleteExisting`（省略可）: 実行前に同名DBの削除を試行

注意:
- 本番環境で `-DeleteExisting` を使うとデータが失われます。
- `wrangler d1 create` 実行後に返る `database_id` を自動で `wrangler.toml` に反映します。

