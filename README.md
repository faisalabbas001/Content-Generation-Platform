<img width="1825" height="946" alt="Pasted image (10)" src="https://github.com/user-attachments/assets/e4a9755e-ea08-4dcf-9ffb-6747169f808e" /># OGz Studios

Arabic-first AI content generation platform for Saudi SME brands. Onboarding → BrandDNA build → calendar generation → QC → publishing, governed by a multi-agent system (CEO/COO/CCO/DeepSeek) with PDPL-compliant data isolation.

> Confidential — weiBlocks. The canonical product spec lives in `doc.txt` (project root). This README only documents how to **run** the codebase locally.

---

<img width="1825" height="946" alt="Pasted image" src="https://github.com/user-attachments/assets/7c3fdc1f-b754-4134-a0a6-8528b983be99" />

<img width="1825" height="946" alt="Pasted image (2)" src="https://github.com/user-attachments/assets/19280697-69ca-47af-a038-bb476a91b655" />

<img width="1825" height="946" alt="Pasted image (3)" src="https://github.com/user-attachments/assets/43fd223a-c698-403e-8ee1-c7d329b4f621" />

<img width="1825" height="946" alt="Pasted image (4)" src="https://github.com/user-attachments/assets/3d5c3ee1-74a8-44b4-b31a-6e00ee83b6cc" />

<img width="1825" height="946" alt="Pasted image (5)" src="https://github.com/user-attachments/assets/0fa8a77d-aa24-4190-8e04-b46be0c75e3d" />

<img width="1825" height="946" alt="Pasted image (6)" src="https://github.com/user-attachments/assets/4bd90bec-cec5-4809-a89f-e24da3538a97" />

<img width="1825" height="946" alt="Pasted image (7)" src="https://github.com/user-attachments/assets/ed879891-fc15-4366-9e00-2009fa27c581" />

<img width="1825" height="946" alt="Pasted image (8)" src="https://github.com/user-attachments/assets/d3d2365c-48de-4755-9bd4-3d589b831bc2" />

<img width="1825" height="946" alt="Pasted image (9)" src="https://github.com/user-attachments/assets/1ae22c84-e2e9-4f1e-81d9-f8c9373c51dd" />

<img width="1825" height="946" alt="Pasted image (10)" src="https://github.com/user-attachments/assets/a98aa5f5-2427-4070-8dd3-037e3675ceb9" />

<img width="1825" height="946" alt="Pasted image (11)" src="https://github.com/user-attachments/assets/4dbf3c60-c9a7-4905-a5b9-79e395f206d9" />

<img width="1825" height="946" alt="Pasted image (12)" src="https://github.com/user-attachments/assets/64af18ef-eea1-42cb-bbb8-750a6c8b2a60" />






## What's in here

A pnpm + Turborepo monorepo. The shape:

```
openclaw-platform/
├── apps/
│   └── web/                     # Next.js 16 — public site, brand dashboard, admin panel
├── packages/
│   ├── ai/                      # CEO/COO/CCO/DeepSeek/Copilot wrappers + prompt loader
│   ├── auth/                    # Client + admin Supabase auth helpers
│   ├── core/                    # Shared Zod schemas (RoutingDecision, BuildBrandDnaResponse, …)
│   ├── db/                      # Supabase clients + typed queries + RLS-scoped pg helpers
│   ├── memory/                  # Memory Controller — sole BrandDNA writer (Hard Rule #2)
│   ├── i18n/                    # Arabic/English translations (Arabic-first)
│   ├── ui/                      # Shared design system + admin chat widget
│   ├── vectors/                 # Qdrant per-brand namespace wrapper
│   ├── image/  scraping/  email/  payments/  pdpl/  shared/  utils/  …
├── n8n/flows/                   # 11 n8n workflow JSONs (A01–A05, B03, V01, D02, S01–S03)
├── prompts/                     # System prompts for CEO/COO/CCO/DeepSeek + 3 copilots
├── supabase/migrations/         # SQL migrations (run via `pnpm db:migrate`)
├── scripts/
│   ├── ai/                      # smoke tests, http smoke, prompt packer
│   ├── db/                      # migrate, seed, gen-types, reset, swap, fix-checksum
│   ├── memory/                  # Memory Controller smoke test
│   ├── n8n/                     # flow injection helpers (idempotent edits to flow JSONs)
│   └── processing/              # realtime smoke test for the /processing page
├── tests/                       # vitest specs — auth, RLS, hard rules, e2e, integration
├── tools/postman/               # Postman collection for the agent API
└── doc.txt                      # PRODUCT SPEC — the source of truth (project root)
```

The 4 Hard Rules and import restrictions are in [`CLAUDE.md`](CLAUDE.md) — read that before changing agent or memory code.

---

## Prerequisites

| | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 (20 LTS recommended) | `engines.node` requires 18+ |
| pnpm | 9.x | enforced via `packageManager` in `package.json` |
| PostgreSQL access | Supabase Cloud project | Free tier is fine for dev |
| Git Bash or PowerShell | — | Windows-friendly; all scripts work in both |

Provider accounts you'll need API keys for (free tiers exist for most):

- **Anthropic** — Claude Sonnet 4.6 (CEO + Copilots) and Haiku 4.5 (COO).
- **OpenAI** — GPT-5 / GPT-4o (CCO Arabic QC).
- **DeepSeek** — V3 (caption generation).
- **fal.ai** — image generation (replaces Weavy).
- **Apify** — Instagram scraper (used by N8N-A03 onboarding).
- **Google Cloud** — Places API key (optional, used by onboarding scraper).
- **Qdrant Cloud** — vector storage for CaptionContext cache (free 1GB cluster works).
- **Supabase** — Postgres + Auth + Storage + Realtime (one project for now; admin instance is a Phase 2 split).
- **n8n Cloud** *or* self-hosted — orchestrates the 11 flows.
- **Resend** — transactional email (optional in dev).
- **Stripe** — billing (optional in dev).
- **PostHog** — analytics (optional in dev).

You can develop most of the platform with just **Anthropic + Supabase + Qdrant**. Everything else has graceful fallbacks (`isVectorsConfigured()`, etc.).

---

## First-time setup

### 1. Install

```bash
git clone <repo-url> openclaw-platform
cd openclaw-platform
pnpm install
```

### 2. Configure env

Copy the template and fill in keys:

```bash
cp .env.example .env.local
```

The `.env.local` at the repo root is the **single source of truth**. A pre-`dev` hook (`scripts/sync-env.mjs`) automatically syncs it to `apps/web/.env.local` before Next.js starts. Don't edit `apps/web/.env.local` directly — your changes get overwritten.

Minimum keys to boot the dev server:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=          # postgres://… for direct pg access (memory controller, copilot RLS)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
N8N_WEBHOOK_SECRET=       # any 64-char hex string; must match the value in n8n cloud
```

Add the others as you need each subsystem (Qdrant for vectors, Apify for onboarding scrapers, etc.).

### 3. Initialize the database

```bash
pnpm db:setup
```

That runs in order:

- `db:migrate` — applies every file in `supabase/migrations/` against `SUPABASE_DB_URL`. Tracks applied migrations in `public.schema_migrations`.
- `db:seed` — inserts sector baselines, occasion intelligence, onboarding questions.
- `db:verify` — sanity-checks RLS policies, indexes, and append-only constraints.

If a migration was edited after applying (just whitespace, etc.), run:

```bash
node scripts/db/_fix-checksum.mjs --all
node scripts/db/_fix-checksum.mjs --cleanup-orphans
```

To regenerate `packages/db/src/schema/database.types.ts` from the live DB:

```bash
pnpm db:types
```

### 4. Create an admin user

```bash
pnpm db:create-admin
pnpm db:confirm-admin   # marks user_metadata.is_admin = true
```

Add the admin email to `ADMIN_ALLOWLIST_EMAILS` in `.env.local` (CSV).

### 5. (Optional) Seed a test brand

```bash
pnpm db:seed-user
```

Creates an end-user account with one fully-onboarded brand so you can poke at `/[slug]/dashboard` immediately.

---

## Running the app

### Start everything

```bash
pnpm dev
```

This runs `turbo run dev`, which currently means **Next.js dev server only** (other packages don't have a `dev` task — they're consumed in-process by the web app).

- Web app: <http://localhost:3000>
- Admin panel: <http://localhost:3000/admin>
- One brand's dashboard: <http://localhost:3000/{slug}>

### Run a single workspace

```bash
pnpm --filter web dev          # only the Next app
pnpm --filter @repo/ai test    # tests in a specific package
```

### Build / lint / typecheck (Turbo cache)

```bash
pnpm build           # next build + every packages/*/build (no-op for source-only packages)
pnpm lint            # eslint across the monorepo
pnpm check-types     # tsc --noEmit across all 26 workspaces
```

### Tests

```bash
pnpm test            # vitest single-shot
pnpm test:watch      # vitest watch
```

### Smoke tests (real DB / real API calls — use sparingly)

```bash
pnpm ai:smoke              # CEO/COO/CCO/DeepSeek live calls; needs all 4 API keys
pnpm ai:http-smoke         # exercises /api/agents/* with HMAC-signed requests
pnpm memory:smoke          # Memory Controller end-to-end
pnpm processing:smoke      # /processing realtime infrastructure check
```

---

## Working with n8n

The 11 flow JSONs are in [`n8n/flows/`](n8n/flows/). To use them:

1. In n8n cloud (or self-hosted), **Workflows → Import from File** for each `.json`.
2. Set the Supabase credential `openclaw_supabase` (Service Role).
3. Set environment variables in n8n: `N8N_WEBHOOK_SECRET` (must match `.env.local`), `N8N_BASE_URL` (your Next.js URL — use ngrok in dev), `APIFY_API_KEY`, `GOOGLE_PLACES_API_KEY`.
4. Toggle each workflow **Active**.

To re-apply automated edits after pulling fresh flow JSONs:

```bash
node scripts/n8n/_inject-stage-emitters.mjs            # /processing realtime stage updates
node scripts/n8n/_inject-a03-qdrant-and-a01-trigger.mjs
node scripts/n8n/_inject-a04-qdrant-invalidate.mjs
```

All injection scripts are idempotent.

For the local-dev tunnel:

```bash
ngrok http 3000
# copy the https URL → set as N8N_BASE_URL in n8n cloud (matches .env.local)
```

---

## Database operations

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Insert sector baselines + occasions + onboarding questions |
| `pnpm db:verify` | Check RLS, indexes, append-only constraints |
| `pnpm db:reset` | **Destructive** — drops the public schema and re-runs migrate + seed |
| `pnpm db:types` | Regenerate `packages/db/src/schema/database.types.ts` |
| `pnpm db:swap` | Swap to a different Supabase project — clients re-read env at call time, no code changes |

---

## Project conventions

- **Hard Rules** (see [`CLAUDE.md`](CLAUDE.md)): CEO always routes first. Memory Controller is the sole BrandDNA writer. Arabic text never in image prompts. Weavy URLs never in the DB.
- **Arabic-first UI**: `<html dir="rtl" lang="ar">` by default; English is a per-user toggle persisted to localStorage.
- **Every AI output is structured JSON** validated with Zod (see `packages/core/src/schemas/`).
- **Every n8n flow has**: trigger + credential ref + usage_logs write + 2× retry with backoff + N8N-S03 alert on final fail.
- **Append-only tables** (`routing_decisions`, `branddna_event_log`, `usage_logs`) are RLS-enforced as INSERT-only — Postgres refuses UPDATE/DELETE.
- **Server-side auth re-verification**: `proxy.ts` does coarse cookie gating; every layout/action ALSO calls `requireUser` / `requireBrandAccess` / `requireAdmin` from `@repo/auth/server`. Belt + braces.

---

## Troubleshooting

**`pnpm dev` exits with code 3221226505 on Windows** — Turbopack/Next 16 cache corruption. Delete `apps/web/.next/` and restart.

**`/api/agents/*` returns 401 in a tight loop** — see the breaker logs (`[n8n-auth] 401 …` in dev terminal). Most common cause: an n8n cloud execution is queued and retrying; stop it from the n8n Executions tab. Second-most-common: `N8N_WEBHOOK_SECRET` doesn't match between `.env.local` and n8n.

**Migration checksum mismatch** — somebody (or you) edited an applied migration file. Run `node scripts/db/_fix-checksum.mjs --all`, then `pnpm db:migrate` again.

**Brand snapshot stuck on `form_submitted`** — check the n8n A03 execution. The dev tunnel (ngrok) URL must be reachable from n8n cloud, and `SUPABASE_SERVICE_ROLE_KEY` must be the real service-role JWT, not the anon key.

**Copilot returns "Anthropic key not set"** — `ANTHROPIC_API_KEY` is missing or empty in `.env.local`. Restart `pnpm dev` after editing.

For more, see [`docs/`](docs/) — especially `auth-foundation.md`, `architecture/`, `db/`, and `deployment.md`.

---

## License

Confidential. All rights reserved — weiBlocks.
