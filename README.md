# PocketPlan

A mobile-first monthly salary budgeting and expense tracker. Budget allocations begin as pending, can be marked budgeted after a transfer, and become immutable when the month is finalized. Expenses remain addable and can include private receipt photos or PDFs.

## Local setup

1. Create a Supabase project and run `supabase/migrations/202607200001_initial_schema.sql` in the SQL editor.
2. Copy `.env.example` to `.env` and add the project URL and anon key.
3. Enable your preferred authentication provider in Supabase Authentication.
4. Run `npm install` and `npm run dev`.

Without environment variables, the app opens with realistic demo data so the interface can be reviewed immediately.

## Deploy to Netlify

Connect this repository, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify environment variables, and deploy. `netlify.toml` supplies the build command, output directory, and single-page-app redirect.

## Data security

Row-level security scopes profiles, months, allocations, and expenses to the signed-in user. Receipt files live in a private `receipts` bucket under a per-user folder. The database also prevents salary/allocation edits after finalization, so the lock is enforced beyond the UI.
