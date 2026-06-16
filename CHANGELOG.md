# Changelog

All non-obvious architectural decisions go here (Doc §11.3).

## [Unreleased]

### 2026-04-28 — Memory Controller (`@repo/memory`)
- **Sole writer for BrandDNA + Layer 2/3 (Hard Rule #2)**. Implements Doc §4.2 contract: CEO nominates → memory_controller_queue → validate → apply → branddna_event_log audit.
- **6 nomination types** (matching the DB enum): `field_update` (writes brand_profiles / audience_profiles / visual_style_profiles columns), `confidence_upgrade` (upserts evidence_bundles), `negative_pattern_add` (per-brand HARD_BLOCK / STRONG_WARN / SOFT_WARN), `override_rule_add` (key/value override), `sector_signal` (Layer 2 — sector_baselines), `global_signal` (Layer 3 — content_performance_patterns).
- **Field whitelist** (`packages/memory/src/types.ts:ALLOWED_FIELD_PATHS`): 14 dotted paths (e.g. `BrandProfile.arabic_dialect`) each mapped to a (table, column, enum/regex/range) tuple. Anything outside the whitelist is rejected with `forbidden_field_path` — CEO cannot invent new fields.
- **PII scrubber** (`validateAnonymousSignal`) on Layer 2/3: rejects payloads containing UUIDs, emails, or > 10 Arabic letters. Doc §4.4 PRIVACY rule enforced in code.
- **Idempotency by SHA-256 fingerprint** of (type, brand_id, sorted-keys data) — CEO retries don't duplicate writes.
- **CEO output translator** (`translateCeoNominations`) — maps the prompt-shape (`field_update | decision_trace | event_log | conflict_flag`) to the DB-shape; drops audit-only types.
- **Append-only event log writer** — every successful write produces one `branddna_event_log` row with the right `event_type` enum (client_confirmed / confidence_upgraded / override_added / source_ingested) and a redacted `event_data` JSONB (no fingerprint, no PII).
- **Concurrency**: claim-update pattern on `memory_controller_queue` (UPDATE … RETURNING with `eq('status','pending')` re-check). Two parallel workers can run safely without double-applying.
- **Direct-pg fallback** (`pg-bypass.ts`) — when `SUPABASE_SERVICE_ROLE_KEY` holds the anon JWT (HANDOVER known issue), validators and appliers route through a single shared `pg.Client` to bypass RLS. Production with a real service-role key skips this path automatically.
- **Auto-enqueue wired into CEO routes** — `/api/agents/ceo/classify` and `/api/agents/ceo/confidence-gate` now call `translateCeoNominations` + `enqueueNominations` after every CEO call. Nothing else changes for n8n; the response gains `{ memory: { enqueued, dropped } }`.
- **`POST /api/memory/process`** — n8n N8N-D02 (1st of month) and end-of-batch hooks call this to drain pending rows. HMAC-signed, 256KB body cap, idempotency-aware.
- **Migrations 0011-0013** — open INSERT/UPDATE on the 16 BrandDNA tables Memory Controller writes to, open SELECT on Layer 2/3 + the queue (Doc §4.3-4.4 compliant), and revert an over-broad SELECT that would have weakened Layer 1 isolation.
- **15 unit tests** in `tests/memory/validators.test.ts` (Zod first-pass, anonymous-signal scrubber, CEO-prompt translator).
- **End-to-end smoke** (`pnpm memory:smoke`) — enqueues 6 nominations (5 valid + 1 forbidden), drains the queue, verifies all writes via direct pg, confirms event log appended, cleans up. **All 7 verifications pass.**

Verified: 65/65 vitest tests pass; web app + memory + core all typecheck clean; live smoke run shows 5 written + 1 correctly rejected with branddna_event_log audit appended.

### 2026-04-28 — AI agent HTTP transport + n8n authentication
- **7 new HTTP routes** under `apps/web/src/app/api/agents/{ceo,coo,cco,deepseek}/*` — every n8n → AI call goes through us (Hard Rule #5). Each route is ~30 lines, sharing `lib/agent-route.ts` for verify → Zod-validate → call wrapper → respond.
- **HMAC-SHA256 webhook auth** (`apps/web/src/lib/n8n-auth.ts`): constant-time signature compare, 5-min timestamp drift bound, 10-min in-memory request-ID dedupe (replay protection), 256KB body cap, optional 5-min idempotency cache. All headers + responses follow `docs/n8n-integration.md`.
- **`N8N_WEBHOOK_SECRET` generated and wired** — 32 random bytes, in `.env.local`. Documented rotation in `docs/n8n-integration.md` §2.
- **`/api/webhooks/n8n` upgraded** — was using timing-vulnerable raw header equality; now uses the shared HMAC verifier and writes an `n8n_callback` row to `usage_logs` for every event.
- **HTTP smoke test** (`pnpm ai:http-smoke`) — 6 security checks pass without AI keys (no signature / bad signature / timestamp drift / Zod rejection / replay 409 / idempotency replay). Two more agent-end-to-end checks run when keys are present.
- **Marketing contact page rebuilt** — was a one-line re-export of the deleted apply form; replaced with a self-contained CTA card.
- **Phase 3 ready** — Doc §11.2 lift-and-shift migration documented in `docs/n8n-integration.md` §8.

Verified: 50/50 tests pass; web app typechecks clean; `ai:http-smoke --only=auth` is 6/6.

### 2026-04-28 — AI C-Suite scaffolding (`@repo/ai`, `@repo/core/schemas`)
- **Schemas** (`@repo/core/schemas/{ceo,coo,cco,deepseek}.ts`) — Zod contracts mirroring `prompts/OGzStudios_*_v1.md` exactly. CEO output is a `routing_decision` envelope with all 11 human-gate triggers + 6 anomaly flags as enums. COO discriminated-union over the three jobs (`build_branddna`, `compile_caption_context`, `score_confidence`). CCO returns a JSON array of post evaluations with controlled-vocab `issues[]`. DeepSeek emits a strict `posts[]` of length `post_count`.
- **Prompt loader** (`@repo/ai/prompts`) — single auditable point that reads `*_SYSTEM_PROMPT` env vars; falls back to `prompts/<file>.md` for local dev. `loadPrompt()` is the only allowed reader (CLAUDE.md import rule).
- **Provider wrappers** (`@repo/ai/{ceo,coo,cco,deepseek}`) — Anthropic SDK 0.91 with `cache_control: ephemeral` on system prompt; OpenAI in JSON mode wrapped in `{evaluations: [...]}` envelope; DeepSeek via OpenAI-compatible endpoint. CCO defaults to `gpt-4o` until OpenAI Tier 4 is confirmed (Doc §13.1) — switch via `OPENAI_CCO_MODEL=gpt-5`.
- **Retry harness** (`@repo/ai/retry`) — Doc §5.4 pattern: 2× retry with 2s/4s backoff. Every attempt writes a `usage_logs` row; final failures append to `anomaly_records` with severity=error.
- **Structured-JSON parser** (`@repo/ai/json`) — strips ```` ```json ```` fences, extracts the first balanced `{}`/`[]` block (string-aware), Zod-validates. Parse failures count as one retry attempt.
- **Cost calculation** — per-model pricing tables (Sonnet 4.6, Haiku 4.5, GPT-5/4o, DeepSeek V3) with prompt-cache discount applied.
- **Migration `0010_observability_policies.sql`** — adds INSERT/SELECT policies for `usage_logs` + `anomaly_records` (0001 enabled RLS but never wrote policies). Service-role can insert; admins read all; brand owners read their own usage; Tech Copilot reads anomalies (Doc §7.2).
- **Smoke test** (`pnpm ai:smoke`) — sends one minimal call per agent, validates the response with Zod, then verifies `usage_logs`/`anomaly_records` via direct pg (bypasses RLS so it works even when the project's "service-role" key is anon). `--only=ceo,coo` to filter.
- **Pack-prompts script** (`pnpm prompts:pack`) — emits ready-to-paste single-line `KEY="..."` env entries for Vercel/n8n production deployment (SEC-06).
- **Missing prompt drafted** — `prompts/OGzStudios_DeepSeek_Prompt_v1.md`. Marked as placeholder; replace with OGz-supplied final before M2 calibration.

Verified: 48/48 tests pass; both packages typecheck clean; smoke run produced 3 usage_logs rows + 1 anomaly_records row matching the §5.4 retry pattern.

### 2026-04-28 — Removed marketing /apply form + leads table
- Deleted `(marketing)/apply` route, `apply-form.tsx`, and `actions/apply.ts`.
- Removed `/apply` links from marketing header + home (CTAs now point to `/signup`).
- Migration `0009_drop_leads.sql` drops `public.leads` and its policies/indexes.
- Removed `leads` from `packages/db/src/schema/database.types.ts`, dropped `applyForm` i18n bundle, removed `apply` reserved-slug + public-path entries.
- Deleted `scripts/db/check-leads.ts`.
- Verified: 30/30 tables present (was 31), 48/48 tests pass.

### 2026-04-27 — Env loading fix
- `next.config.ts` now uses `@next/env`'s `loadEnvConfig` (the same loader Next.js uses internally) against both workspace root and app dir. This guarantees `NEXT_PUBLIC_*` vars are inlined into the browser bundle.
- Added `scripts/sync-env.mjs` invoked via `predev`/`prebuild` to mirror workspace-root `.env.local` to `apps/web/.env.local` as a defensive fallback. Idempotent; respects per-app overrides.
- Resolves `Supabase env var "NEXT_PUBLIC_SUPABASE_URL" is not set` thrown by `browserClient()` during signup / login / Google OAuth.

### 2026-04-27 — Auth foundation
- Built `@repo/auth` package (client/server/admin/proxy/slug subpaths).
- Added Next.js 16 `proxy.ts` (renamed from middleware) for route-level session refresh + coarse gating.
- Wired Google OAuth + `/api/auth/callback` route.
- Onboarding form persists to `brand_profiles` with auto-generated slug; ensures uniqueness; reserves system slugs.
- Added `leads` table (migration 0006) for marketing /apply submissions; PDPL-compliant ip_hash, no raw IPs.
- Settings actions: profile / password / notifications / account-delete-request.
- Admin QA approve/reject server actions; logged via `usage_logs`.
- Auth-aware marketing header (login/signup vs dashboard/logout).
- Logout button in client header.
- `next.config.ts` loads workspace-root `.env.local` via dotenv (no per-app duplication).
- 47 vitest tests covering slug rules, proxy routing, admin allowlist, live Supabase signup/login.
- Added `pnpm db:swap` and `pnpm db:confirm-admin` helpers.
- Scrubbed real secrets from `.env.example`.
- See `docs/auth-foundation.md`.

### Initial scaffold
- Initial Turborepo monorepo scaffold (Phase-6-ready layout).

