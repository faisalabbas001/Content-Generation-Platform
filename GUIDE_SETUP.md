# OGz Studios — Setup Guide

Goal: stand up the full client + admin UI with seeded dummy data, on **any** Supabase account you choose, in about 10 minutes.

The guide is credential-agnostic. Start with your personal Supabase; swap to the OGz project later by editing one file.

---

## 1. Prerequisites

- Node 20+
- pnpm 9+ (`corepack enable` then `corepack use pnpm@9`)
- A Supabase project (free tier is fine for dev)

## 2. Get Supabase credentials

Go to **Supabase dashboard → your project → Project settings → API**. Copy:

| Label in dashboard                | Env variable                        |
|-----------------------------------|-------------------------------------|
| Project URL                       | `SUPABASE_URL`                      |
| `anon public` API key             | `SUPABASE_ANON_KEY`                 |
| `service_role` secret key         | `SUPABASE_SERVICE_ROLE_KEY`         |

Then **Project settings → Database → Database password** (or "Reset database password" if you never saved it):

| Label                             | Env variable                        |
|-----------------------------------|-------------------------------------|
| Database password                 | `SUPABASE_DB_PASSWORD`              |

## 3. Create `.env.local`

```bash
cp .env.example .env.local
```

Fill these (leave every other line untouched for now):

```env
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_DB_PASSWORD=<db password>

NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

(The `NEXT_PUBLIC_*` pair is identical to the non-prefixed ones — Next.js requires the prefix to expose values to the browser.)

## 4. Install dependencies

```bash
pnpm install
```

## 5. One-shot database bootstrap

```bash
pnpm db:setup
```

This runs three steps against the Supabase project identified by `SUPABASE_URL`:

1. `pnpm db:migrate` — applies every `supabase/migrations/*.sql` in order. Tracked in `schema_migrations` so re-running skips applied files. Detects hand-edits to applied files and refuses to continue (you'd create a new migration instead).
2. `pnpm db:seed` — runs every `supabase/seeds/*.sql`. Creates **3 dummy brands** (F&B Najdi / Retail Hejazi / Beauty_Wellness Gulf), their evidence bundles, two delivered calendars with 20 posts each, a QA queue, anomalies, usage logs, routing decisions, events.
3. `pnpm db:verify` — sanity-checks the result. Fails with a clear list if anything is missing.

Expected output, end to end:

```
→ Verifying https://***@xxx.supabase.co
  ✓ 29/29 tables present
  ✓ RLS enabled on 29/29 tables
  ✓ 3 brand_profiles rows
  ✓ 15 occasion rows
  ✓ 3 baseline rows
✓ verification passed
```

## 6. Run the app

```bash
pnpm dev
```

Open <http://localhost:3000>. You should see:

- The landing page with a tile for each dummy brand.
- Click any brand → `/<slug>/snapshot` → full client platform (7 screens).
- Click **لوحة الإدارة** → `/admin` → admin panel (9 views).

All 7 client screens and 9 admin views are wired to live DB reads. Pages have `force-dynamic` so they always reflect the current DB state.

## 7. Swapping to a different Supabase account (e.g. OGz)

Only `.env.local` changes:

```bash
# edit .env.local, replace the 4 Supabase vars and the two NEXT_PUBLIC_* entries
pnpm db:setup
```

Everything else — schema, seed, UI — is identical. No code edits.

## 8. Day-to-day commands

| Command             | Purpose |
|---------------------|---------|
| `pnpm dev`          | Next.js dev server (http://localhost:3000) |
| `pnpm db:migrate`   | Apply new migrations only |
| `pnpm db:seed`      | Re-insert dummy data (idempotent — uses deterministic UUIDs) |
| `pnpm db:verify`    | Sanity-check the DB |
| `pnpm db:create-admin -- <email> <password>` | Create/update an admin auth user (`is_admin=true`) |
| `pnpm db:reset -- --yes` | **Destructive.** Drops `public` schema, re-migrates, re-seeds |
| `pnpm build`        | Production build of every app/package |
| `pnpm check-types`  | TypeScript check across the workspace |

## 8.1 Admin access setup

After DB setup, create at least one admin user so `/admin` is protected and accessible:

```bash
pnpm db:create-admin -- admin@example.com "StrongPassword123!"
```

Optional (recommended when service-role key is not configured yet), allow specific emails in `.env.local`:

```env
ADMIN_ALLOWLIST_EMAILS=admin@example.com
```

Then sign in from:

```text
/admin-access
```

Users marked with `user_metadata.is_admin=true` can enter `/admin`.
Allowlisted emails in `ADMIN_ALLOWLIST_EMAILS` are also accepted.

## 9. Adding new schema changes

Never edit an applied migration. Create a new file:

```bash
# e.g. supabase/migrations/0006_add_postiz_field.sql
```

The migrator records SHA-256 of every applied file; editing one throws an explicit error instead of silently diverging envs.

## 10. Project layout cheat-sheet

```
apps/web/                    ← Next.js app (client + admin)
  src/app/page.tsx           ← landing
  src/app/[slug]/*           ← 7 client screens
  src/app/admin/*            ← 9 admin views
  src/app/api/webhooks/*     ← Stripe / n8n / correction
  src/app/api/copilot/[role] ← Management / Tech / Production Copilot
  src/components/ui.tsx      ← shared Arabic-RTL primitives
  src/lib/format.ts          ← locale-aware formatters

packages/db/                 ← @repo/db — Supabase clients + typed queries
  src/client/                ← browser / server / admin factories
  src/queries/               ← brands, calendars, admin, occasions, snapshots
  src/types.ts               ← hand-written domain types

supabase/migrations/*.sql    ← idempotent schema files (run in order)
supabase/seeds/*.sql         ← dummy data (dev-only)

scripts/db/                  ← Node runners: migrate.ts / seed.ts / verify.ts / reset.ts
```

## 11. What is intentionally NOT wired yet

These are scheduled in `project_plan/01_Master_Plan.csv`, not forgotten:

- Supabase Auth (Sprint S1.04 / S4.04) — routes currently return mock data via `adminClient()`; the browser client is in place and will be switched on when auth is wired.
- Stripe checkout (S6.05) — route stub returns 501.
- n8n webhook handlers (S7.01) — route stub returns 501.
- Copilot AI (S7.06 / S8.05) — route stub returns a placeholder message.

Each has a `sprint:` tag in its response body so you can grep for what's left.

## 12. Troubleshooting

**`Cannot connect to database`** — double-check `SUPABASE_DB_PASSWORD` (reset it from the dashboard if lost).

**`schema_migrations` conflict** — someone edited an applied migration. Revert the file or drop+recreate with `pnpm db:reset -- --yes`.

**`Missing env var: NEXT_PUBLIC_SUPABASE_URL`** in the browser — you set the server-side `SUPABASE_URL` but forgot the `NEXT_PUBLIC_` copy. The two are intentionally separate so server secrets never leak.

**RLS is blocking my query** — pages use `adminClient()` (service_role) for read paths during Phase 1 dev. When Supabase Auth lands, the client screens will switch to `browserClient()` / `serverClient()`. The admin panel continues using `adminClient()`.
