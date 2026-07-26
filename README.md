# PocketPlan

A mobile-first monthly salary budgeting and expense tracker. Budget allocations begin as pending, can be marked budgeted after a transfer, and become immutable when the month is finalized. Expenses remain addable and can include private receipt photos or PDFs.

## Local setup

1. Start a Supabase-compatible backend and apply every SQL file in `supabase/migrations` in filename order.
2. Copy `.env.example` to `.env` and add the API URL and anon key.
3. Enable your preferred authentication provider in Supabase Authentication.
4. Run `npm install` and `npm run dev`.

Without environment variables, the app opens with realistic demo data so the interface can be reviewed immediately.

## Deploy to the VPS

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.production`,
then run `docker compose --env-file .env.production -f compose.vps.yaml up -d
--build`. The container serves the static SPA through unprivileged Nginx and
joins the shared `proxy` network for Caddy.

`deployment/Caddyfile.vps` contains the VPS routes. The sslip.io hostname works
without a DNS change; the custom hostname becomes active once its DNS record
points to the VPS.

The production backend is a separate self-hosted Supabase Compose project.
`deployment/supabase-local.override.yml` gives its containers unique names,
removes direct host ports, and exposes only Kong to the shared Caddy network.
Keep the generated backend `.env` on the VPS; never commit it.

`deployment/backup-supabase.sh` creates verified database and receipt-file
archives. Production runs it nightly under `flock` and retains 30 days of
backups in `/home/ali/backups/pocketplan`.

GitHub Pages continues to build with `/pocketplan/` as its base path. VPS builds
set `VITE_BASE_PATH=/` automatically.

## Data security

Row-level security scopes profiles, months, allocations, and expenses to the signed-in user. Receipt files live in a private `receipts` bucket under a per-user folder. The database also prevents salary/allocation edits after finalization, so the lock is enforced beyond the UI.
