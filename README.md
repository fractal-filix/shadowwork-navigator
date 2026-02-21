# shadowwork-navigator (monorepo)

## Structure
- `apps/web` : Cloudflare Pages
- `apps/api` : Cloudflare Workers
- `packages/*` : shared packages (reserved)

## Deploy

### Cloudflare Pages (web)
- Production: https://shadowwork-navigator.com
- Pages URL: https://shadowwork-navigator.pages.dev
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

Wrangler:
- Config: `apps/api/wrangler.toml`
- Environments: `staging`, `production` (no dev env)

Secrets / vars (Production):
- `ADMIN_MEMBER_IDS`
- `APP_ENV`
- `JWT_SIGNING_SECRET`
- `MEMBERSTACK_SECRET_KEY`
- `OPENAI_API_KEY`
- `PAID_ADMIN_TOKEN`
- `STRIPE_PRICE_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
