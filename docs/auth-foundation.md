# Auth Foundation — Phase 1 Setup Guide

This document is the source of truth for how authentication, route protection, and session handling work in OGz Studios. It also documents the "swap to a different Supabase project" workflow so the lead can hand the system to OGz with zero code changes.

---

## What's wired up

| Surface | Status | Location |
|---|---|---|
| Marketing site (public) | ✅ | `apps/web/src/app/(marketing)/` |
| Email/password signup | ✅ | `(auth)/signup` + `@repo/auth/client` |
| Email/password login | ✅ | `(auth)/login` + `@repo/auth/client` |
| Google OAuth (signup + login) | ✅ | `<GoogleAuthButton>` + `/api/auth/callback` |
| Cross-links (signup ↔ login) | ✅ | both pages |
| Auth-aware marketing header | ✅ | `(marketing)/layout.tsx` |
| Logout button (client header) | ✅ | `[slug]/layout.tsx` |
| Onboarding form → brand creation | ✅ | `/onboarding-start` + `actions/onboarding.ts` |
| Slug auto-generation (Arabic-aware) | ✅ | `@repo/auth/slug` |
| Settings: profile / password / notifications / delete | ✅ | `[slug]/settings` + `actions/settings.ts` |
| Admin login (separate cookie session) | ✅ | `/admin-access` + `/api/admin/auth/*` |
| Admin QA queue approve/reject | ✅ | `admin/qa` + `actions/qa.ts` |
| Route protection — `proxy.ts` | ✅ | `apps/web/src/proxy.ts` (Next.js 16 rename of `middleware.ts`) |
| Server-side guards | ✅ | `@repo/auth/server` (`requireUser`, `requireBrandAccess`) |
| Tests | ✅ | `tests/auth/*.test.ts` (47/47 passing) |

## Architecture — the @repo/auth package

```
packages/auth/src/
├── index.ts             # convenience re-exports
├── types.ts             # AuthCredentials, SignupCredentials, OAuthProvider…
├── slug.ts              # generateSlug, nextCandidate, isReservedSlug
├── client/index.ts      # 'use client' — signup/login/oauth/logout
├── server/index.ts      # 'server-only' — getCurrentUser, requireUser, requireBrandAccess
├── admin/index.ts       # 'server-only' — requireAdmin, isAdminPrincipal, allowlist
└── proxy/index.ts       # NextRequest helpers — refreshSession, public/admin/client path detection
```

**Subpath imports** keep bundles clean:
```ts
import { signOut } from '@repo/auth/client'              // browser
import { requireBrandAccess } from '@repo/auth/server'   // server component / server action
import { requireAdmin } from '@repo/auth/admin'          // admin server component
import { generateSlug } from '@repo/auth/slug'           // anywhere
```

## Two layers of protection (belt + braces)

Per the Next.js 16 [proxy.md](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) doc:

> Server Functions are not separate routes... a Proxy matcher that excludes a path will also skip Server Function calls on that path. **Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone.**

So we do both:

1. **`apps/web/src/proxy.ts`** — refreshes the Supabase session cookies on every request and rejects unauth access at the URL level:
   - Public paths (marketing, /login, /signup, /api/auth/callback…) pass through.
   - `/admin/*` requires the `oc_admin_access` cookie or 307 → `/admin-access?next=…`.
   - `/[slug]/*` requires a Supabase session or 307 → `/login?next=…`.
   - Logged-in users hitting `/login` or `/signup` get redirected to their dashboard.

2. **Server-side guards** — every protected layout/action also calls one of:
   - `requireUser()` — redirects to `/login` if no session.
   - `requireBrandAccess(slug)` — redirects to `/onboarding-start` if the user doesn't own the slug. Used in `[slug]/layout.tsx`.
   - `requireAdmin()` — redirects to `/admin-access` if not allowlisted/flagged.

## Admin user (dev)

| Field | Value |
|---|---|
| Email | `admin@openclaw.dev` |
| Password | `Admin@OGz Studios2026!` |
| Login URL | `http://localhost:3000/admin-access` |

Created via `pnpm db:create-admin -- admin@openclaw.dev '…'`. The dev fallback (because the configured `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is actually the anon key) used anon signup + a direct SQL update to set `email_confirmed_at` and `raw_user_meta_data.is_admin = true`. Re-run via `pnpm db:confirm-admin <email>` if you ever need to re-flag.

> ⚠️ The current `.env.local` has the **anon JWT pasted into the `SUPABASE_SERVICE_ROLE_KEY` slot**. Replace with the real `service_role` key from Supabase Dashboard → Project Settings → API → secret before staging/prod, otherwise admin user creation falls back to anon-signup mode.

## How env vars reach the browser bundle (workspace setup)

Next.js auto-loads `.env*` files from the **app directory** (`apps/web/`) only — not from the workspace root. `NEXT_PUBLIC_*` vars are special: they're *inlined* into the browser bundle at startup, so setting them via `dotenv` inside `next.config.ts` is too late for the bundler.

Two layers handle this so you maintain `.env.local` in **one place** (workspace root):

1. **`apps/web/next.config.ts`** calls `loadEnvConfig` from `@next/env` (the same module Next.js uses internally) against the workspace root *and* the app dir, before exporting the config:
   ```ts
   import { loadEnvConfig } from '@next/env'
   loadEnvConfig(workspaceRoot, dev)
   loadEnvConfig(__dirname, dev)
   ```
2. **`predev` / `prebuild` hooks** run `scripts/sync-env.mjs`, which copies workspace-root `.env.local` to `apps/web/.env.local`. This is the belt-and-braces fallback for any Turbopack code path that reads only the per-app file.

Result on `pnpm dev`:
```
> node ../../scripts/sync-env.mjs
✓ synced .env.local → apps/web/.env.local
> next dev
- Environments: .env.local
✓ Ready
```

If you ever see `Supabase env var "NEXT_PUBLIC_SUPABASE_URL" is not set` again:
1. Confirm `.env.local` exists at the workspace root and contains `NEXT_PUBLIC_SUPABASE_URL`.
2. Run `node scripts/sync-env.mjs` manually.
3. Restart the dev server (Ctrl-C then `pnpm --filter web dev`). Turbopack does NOT hot-reload env changes.

## Switching to a different Supabase project

The whole auth + DB stack is env-driven. Zero code changes are needed when OGz hands you their own Supabase project.

```bash
# 1. Edit .env.local — replace these with the new project's values:
#    SUPABASE_URL                    NEXT_PUBLIC_SUPABASE_URL
#    SUPABASE_ANON_KEY               NEXT_PUBLIC_SUPABASE_ANON_KEY
#    SUPABASE_SERVICE_ROLE_KEY       (real service-role JWT)
#    SUPABASE_DB_PASSWORD or SUPABASE_DB_URL
#    SUPABASE_ADMIN_URL              SUPABASE_ADMIN_SERVICE_KEY (if separate project)

# 2. Apply schema + seeds + verify
pnpm db:swap                # = migrate + seed + verify (idempotent)

# 3. Provision an admin user
pnpm db:create-admin -- admin@yourdomain.com 'StrongPassword!'

# 4. Restart dev (env loaded via apps/web/next.config.ts → dotenv from repo root)
pnpm --filter web dev
```

The `pnpm db:setup` script (and individual `db:migrate`, `db:seed`, `db:verify` scripts) read from the same `.env.local` and never embed project URLs. All Supabase clients in `@repo/db/client` and `@repo/auth/admin` resolve env vars at call-time.

## How a new dev gets unblocked (no shared knowledge needed)

1. `git clone … && cd openclaw-platform && pnpm install`.
2. Copy `.env.example` → `.env.local`. Fill Supabase values for the project the team is using.
3. `pnpm db:setup` — applies migrations + seeds the 3 demo brands and 15 occasions.
4. `pnpm db:create-admin -- admin@you.dev 'YourPassword!'`.
5. `pnpm --filter web dev`.
6. Open `http://localhost:3000` — marketing home. Sign up, fill onboarding, see your `/[slug]/dashboard`.
7. Sign out, then go to `/admin-access`, log in as admin → see all 16 admin views.

**Run the test suite anytime:**
```bash
pnpm test               # 47 tests across slug, proxy routing, admin allowlist, integration
SKIP_INTEGRATION=1 pnpm test    # skip the live Supabase round-trip
```

## Known foundation gaps (intentional — not in Tier 1)

These are deferred to the dev sprint owners per the Master Plan:
- Stripe checkout & webhook (Sprint S6.05) — `/api/webhooks/stripe` is 501.
- Copilot endpoints (Sprint S7.06/S8.05) — placeholder stub.
- n8n flow logic — flows are scaffolded, no business logic yet.
- AI integrations (CEO/COO/CCO/DeepSeek calls) — wrappers exist, prompts pending.
- Real Weavy + Sharp Arabic overlay — stubs only.
- Admin Supabase project — currently shares the client project (Phase 1 acceptable).
- Real `SUPABASE_SERVICE_ROLE_KEY` — paste before staging.

---

## Quick file map (where each developer plugs in)

| Owner | What they touch | Don't break |
|---|---|---|
| Dev 1 (Lead) | `services/`, `n8n/`, `@repo/ai`, `@repo/memory`, BrandDNA writes | `@repo/auth`, RLS policies, append-only tables |
| Dev 2 (FE) | `apps/web/src/app/[slug]/`, `admin/`, `(marketing)/`, `@repo/ui` | `proxy.ts`, server-side guards |
| Dev 3 (BE/Visual) | `@repo/image`, `@repo/scraping`, Storage paths, N8N-V01 | Hard Rules #3 (no Arabic in image prompts), #4 (no Weavy URLs in DB) |

Each layer is independent: front-end devs can iterate on UI without touching auth code; back-end devs can build n8n flows without touching client code; the lead can wire AI agents without breaking auth — as long as everyone respects the 4 Hard Rules in `CLAUDE.md`.
