# OGz Studios — Rules for Claude Code

## 4 Hard Rules (Doc §1.4) — never violate

1. **CEO always routes first.** n8n never calls COO/CCO directly. Every request goes through CEO → CEO instructs what to call next.
2. **Memory Controller is the sole BrandDNA writer.** No agent writes to Layer 1 tables directly. CEO nominates → memory_controller_queue → Memory Controller validates → writes.
3. **Arabic text NEVER in image prompts.** Arabic is applied *after* generation via Sharp overlay in N8N-V01.
4. **Weavy CDN URLs NEVER in the database.** Always download from Weavy and re-upload to Supabase Storage. Only Supabase Storage URLs are persisted.

## Import restrictions (enforced by ESLint)

- Only `@openclaw/memory` may import `@openclaw/db` service-role helpers for Layer 1 tables.
- Only `@openclaw/image/weavy_client` may call the Weavy HTTP API.
- Only `@openclaw/ai/prompts` may read `*_SYSTEM_PROMPT` env vars.

## Conventions

- Arabic-first UI: `<html dir="rtl" lang="ar">` by default; toggle persisted to localStorage.
- Every AI output is structured JSON validated with Zod.
- Every append-only table (routing_decisions, branddna_event_log) is enforced via RLS NO UPDATE / NO DELETE policies.
- Every n8n flow has: trigger + credential ref + usage_logs write + error branch (2× retry + backoff) + N8N-S03 on final fail.

## Auth foundation (built on Phase 1 setup)

Read `docs/auth-foundation.md` before touching auth code. TL;DR:
- Next.js 16: `proxy.ts` (NOT `middleware.ts`) at `apps/web/src/proxy.ts` does session refresh + coarse route gating.
- Server-side guards (`@repo/auth/server`) re-verify in every layout/action — proxy alone is NOT sufficient (per Next.js docs on Server Functions).
- Use `requireBrandAccess(slug)` in `[slug]/*` layouts to enforce ownership.
- Use `requireAdmin()` in `admin/*` layouts.
- Auth + DB clients read from env vars at call time — swap Supabase projects via `pnpm db:swap` without code changes.

