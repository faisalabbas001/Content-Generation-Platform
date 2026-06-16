# Handover — OGz Studios

This document is the M3 deliverable. See `handover/` for milestone acceptance evidence.

> **Foundation status (Phase 1, pre-sprint):** UI scaffolded for all 7 client + 9 admin + marketing screens. Auth flows fully working (email/password + Google OAuth + admin allowlist + JWT-based session). Route protection via Next.js 16 `proxy.ts` + server-side `requireUser`/`requireBrandAccess`/`requireAdmin`. See `docs/auth-foundation.md` for the full map.

## How to run locally
1. `pnpm install`
2. Copy `.env.example` → `.env.local`, fill values from Supabase dashboard. **Important:** the `SUPABASE_SERVICE_ROLE_KEY` slot must hold the real `service_role` JWT (not the anon key — they're easy to confuse).
3. `pnpm db:setup` — applies migrations, loads seed brands/occasions/baselines, verifies 30 tables + RLS.
4. `pnpm db:create-admin -- admin@your-domain.com 'YourStrongPass!'` — provisions one admin user.
5. `pnpm --filter web dev` — opens at `http://localhost:3000`.
6. `pnpm test` — 47 unit + integration tests; expect all green.

## Switching to a new Supabase project
Edit `.env.local`, then `pnpm db:swap` (= migrate + seed + verify). Zero code changes — every client reads env at call time. Full guide: `docs/auth-foundation.md`.

## How to deploy
- Vercel auto-deploys `apps/web` on push to `main`.
- Supabase migrations applied via `pnpm db:migrate:prod` (GitHub Action).
- n8n flows imported from `n8n/flows/*.json` via the n8n Pro UI.

## How to add a new brand (for testing)
See `scripts/seed_dev_brands.ts`.

## How to read the event log
`branddna_event_log` is append-only. Query by brand_id + event_type. See `docs/architecture/brand_dna_layers.md`.

## How to handle an incident
See `docs/runbooks/`.

