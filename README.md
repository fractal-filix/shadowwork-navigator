# shadowwork-navigator (monorepo)

## Structure
- `apps/web` : Cloudflare Pages
- `apps/api` : Cloudflare Workers
- `packages/*` : shared packages (reserved)

## Deploy

## Branch / Release Flow

- `main`: 開発の統合ブランチ
- `staging`: staging 環境での検証ブランチ
- `production`: 本番公開ブランチ

通常フロー:
1. `main` から作業ブランチを切る
2. 作業ブランチを `main` へ PR で反映する
3. `main` を `staging` へ反映する
4. `staging` のコミットを staging 環境へ反映して検証する
5. 検証OKの `staging` を `production` へ反映する

運用ルール:
- 本番へ出すコミットは、必ず staging で確認済みのコミットに限定する
- `main` と `production` への直接 push は行わず、PR 経由で反映する

### Cloudflare Pages (web)
- Production: https://shadowwork-navigator.com
- Pages URL: https://shadowwork-navigator.pages.dev
- Production branch: `production`
- Root directory: `apps/web`
- Output directory: `pages`
- Build command: (none)

Environment variables / secrets (Production):
- `TOKUSHOHO_ADDRESS`
- `TOKUSHOHO_EMAIL`
- `TOKUSHOHO_PHONE`
- `TOKUSHOHO_RESPONSIBLE_NAME`

### Cloudflare Workers (api)
- Worker URL (dev subdomain): https://filix-shadowwork-api.<subdomain>.workers.dev
- Root directory: `apps/api`
- Build command (CI): `pnpm install --frozen-lockfile && pnpm run build`
- Deploy command (CI): `pnpm exec wrangler deploy --env=production`

反映順序:
- staging 検証時: `staging` ブランチの対象コミットを `--env=staging` へ反映する
- 本番反映時: `production` ブランチの対象コミットを `--env=production` へ反映する

Wrangler:
- Config: `apps/api/wrangler.toml`
- Environments: `staging`, `production` (no dev env)

Secrets / vars (Production):
- `ADMIN_MEMBER_IDS`
- `APP_ENV`
- `JWT_SIGNING_SECRET`
- `SUPABASE_JWKS_URL`
- `OPENAI_API_KEY`
- `PAID_ADMIN_TOKEN`
- `STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
