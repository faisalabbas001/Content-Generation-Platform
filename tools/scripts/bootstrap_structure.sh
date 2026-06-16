#!/usr/bin/env bash
# OpenClaw — Phase-6-ready folder structure bootstrap
# Safe to re-run: creates only what's missing; never overwrites existing files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "→ Bootstrapping OpenClaw structure under: $ROOT"

# ────────────────────────────────────────────────────────────
# 1. Top-level directories (Doc §11.3, §5, §7.4, handover)
# ────────────────────────────────────────────────────────────
TOP_DIRS=(
  ".github/workflows"
  "supabase/migrations"
  "supabase/functions"
  "n8n/flows"
  "n8n/docs"
  "docs/adr"
  "docs/runbooks"
  "docs/architecture"
  "docs/db"
  "docs/onboarding"
  "docs/api"
  "tests/integration"
  "tests/e2e"
  "tests/load"
  "tests/arabic_qa"
  "tests/hard_rules"
  "tests/fixtures/brands"
  "tests/fixtures/caption_contexts"
  "tests/fixtures/cco_responses"
  "handover/access"
  "scripts"
  "project_plan"
)

for d in "${TOP_DIRS[@]}"; do
  mkdir -p "$d"
done

# ────────────────────────────────────────────────────────────
# 2. apps/web — client + admin + api routes (Doc §8.1)
# ────────────────────────────────────────────────────────────
APP_DIRS=(
  "apps/web/src/app/(marketing)"
  "apps/web/src/app/[slug]/auth"
  "apps/web/src/app/[slug]/onboarding"
  "apps/web/src/app/[slug]/processing"
  "apps/web/src/app/[slug]/snapshot"
  "apps/web/src/app/[slug]/calendar/[month]"
  "apps/web/src/app/[slug]/profile"
  "apps/web/src/app/[slug]/upgrade"
  "apps/web/src/app/admin/qa"
  "apps/web/src/app/admin/cost"
  "apps/web/src/app/admin/anomalies"
  "apps/web/src/app/admin/routing"
  "apps/web/src/app/admin/branddna/[brand_id]"
  "apps/web/src/app/admin/flows"
  "apps/web/src/app/admin/baselines"
  "apps/web/src/app/admin/occasions"
  "apps/web/src/app/api/webhooks/stripe"
  "apps/web/src/app/api/webhooks/n8n"
  "apps/web/src/app/api/webhooks/correction"
  "apps/web/src/app/api/copilot/[role]"
  "apps/web/src/components/client"
  "apps/web/src/components/admin"
  "apps/web/src/hooks"
  "apps/web/src/lib"
  "apps/web/public/fonts"
  "apps/web/public/logos"
  "apps/web/public/images"
  "apps/web/tests/e2e"
)

for d in "${APP_DIRS[@]}"; do
  mkdir -p "$d"
done

# ────────────────────────────────────────────────────────────
# 3. Phase 5 + Phase 2/3 deployables (stubs only — do not deploy)
# ────────────────────────────────────────────────────────────
mkdir -p apps/agency-api/src
mkdir -p apps/admin-cli/src/commands
mkdir -p services/pdpl-janitor/src
mkdir -p services/cio-analyzer/src
mkdir -p services/generation-worker/src

# ────────────────────────────────────────────────────────────
# 4. Missing packages (so Phase 2-6 deployables can import cleanly)
# ────────────────────────────────────────────────────────────
PKG_DIRS=(
  "packages/ai/src/providers"
  "packages/ai/src/schemas"
  "packages/memory/src/nominations"
  "packages/image/src/sharp"
  "packages/vectors/src"
  "packages/scraping/src"
  "packages/payments/src"
  "packages/pdpl/src"
  "packages/analytics/src"
  "packages/auth/src"
  "packages/i18n/src"
  "packages/config/src"
  "packages/utils/src"
)

for d in "${PKG_DIRS[@]}"; do
  mkdir -p "$d"
done

# Flesh out existing placeholder packages
mkdir -p packages/core/src/{types,schemas,confidence,human_gate,constants}
mkdir -p packages/core/tests/hard_rules
mkdir -p packages/db/src/{queries,client,schema,seeds}
mkdir -p packages/email/src/{components,templates}
mkdir -p packages/n8n/src/{flows,nodes,triggers}
mkdir -p packages/shared/src/{config,constants,errors,types,utils}
mkdir -p packages/ui/src/{primitives,client,admin,hooks}

# ────────────────────────────────────────────────────────────
# 5. .gitkeep in empty leaf dirs so Git tracks them
# ────────────────────────────────────────────────────────────
find supabase n8n docs tests handover scripts project_plan services apps packages -type d -empty -exec touch {}/.gitkeep \; 2>/dev/null || true

# ────────────────────────────────────────────────────────────
# 6. READMEs for every non-trivial directory
# ────────────────────────────────────────────────────────────
write_if_missing () {
  local path="$1"
  local content="$2"
  if [ ! -f "$path" ]; then
    printf '%s\n' "$content" > "$path"
    echo "  + $path"
  fi
}

# Root-level docs
write_if_missing "CLAUDE.md" "# OpenClaw — Rules for Claude Code

## 4 Hard Rules (Doc §1.4) — never violate

1. **CEO always routes first.** n8n never calls COO/CCO directly. Every request goes through CEO → CEO instructs what to call next.
2. **Memory Controller is the sole BrandDNA writer.** No agent writes to Layer 1 tables directly. CEO nominates → memory_controller_queue → Memory Controller validates → writes.
3. **Arabic text NEVER in image prompts.** Arabic is applied *after* generation via Sharp overlay in N8N-V01.
4. **Weavy CDN URLs NEVER in the database.** Always download from Weavy and re-upload to Supabase Storage. Only Supabase Storage URLs are persisted.

## Import restrictions (enforced by ESLint)

- Only \`@openclaw/memory\` may import \`@openclaw/db\` service-role helpers for Layer 1 tables.
- Only \`@openclaw/image/weavy_client\` may call the Weavy HTTP API.
- Only \`@openclaw/ai/prompts\` may read \`*_SYSTEM_PROMPT\` env vars.

## Conventions

- Arabic-first UI: \`<html dir=\"rtl\" lang=\"ar\">\` by default; toggle persisted to localStorage.
- Every AI output is structured JSON validated with Zod.
- Every append-only table (routing_decisions, branddna_event_log) is enforced via RLS NO UPDATE / NO DELETE policies.
- Every n8n flow has: trigger + credential ref + usage_logs write + error branch (2× retry + backoff) + N8N-S03 on final fail.
"

write_if_missing "CHANGELOG.md" "# Changelog

All non-obvious architectural decisions go here (Doc §11.3).

## [Unreleased]
- Initial Turborepo monorepo scaffold (Phase-6-ready layout).
"

write_if_missing "HANDOVER.md" "# Handover — OGz Studios

This document is the M3 deliverable. See \`handover/\` for milestone acceptance evidence.

## How to run locally
1. \`pnpm install\`
2. Copy \`.env.example\` → \`.env.local\`, fill values from Vercel dashboard.
3. \`pnpm supabase start\` (requires Docker).
4. \`pnpm --filter @openclaw/web dev\`.

## How to deploy
- Vercel auto-deploys \`apps/web\` on push to \`main\`.
- Supabase migrations applied via \`pnpm db:migrate:prod\` (GitHub Action).
- n8n flows imported from \`n8n/flows/*.json\` via the n8n Pro UI.

## How to add a new brand (for testing)
See \`scripts/seed_dev_brands.ts\`.

## How to read the event log
\`branddna_event_log\` is append-only. Query by brand_id + event_type. See \`docs/architecture/brand_dna_layers.md\`.

## How to handle an incident
See \`docs/runbooks/\`.
"

write_if_missing ".env.example" "# OpenClaw — environment variables (Doc §2.2)
# Copy this file to .env.local for development. NEVER commit .env* files.

# ── AI ─────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
DEEPSEEK_API_KEY=

# ── AI prompts (OGz-supplied; stored as env-only per SEC-06) ──
CEO_SYSTEM_PROMPT=
COO_SYSTEM_PROMPT=
CCO_SYSTEM_PROMPT=
DEEPSEEK_SYSTEM_PROMPT=
COPILOT_MANAGEMENT_PROMPT=
COPILOT_TECH_PROMPT=
COPILOT_PRODUCTION_PROMPT=

# ── Image generation ───────────────────────────────────────────
WEAVY_API_KEY=
NANO_BANANA_API_KEY=
FLUX_ULTRA_API_KEY=

# ── Supabase (client instance) ─────────────────────────────────
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── Supabase (admin instance) ──────────────────────────────────
SUPABASE_ADMIN_URL=
SUPABASE_ADMIN_SERVICE_KEY=

# ── Vectors ────────────────────────────────────────────────────
QDRANT_URL=
QDRANT_API_KEY=

# ── Email ──────────────────────────────────────────────────────
RESEND_API_KEY=

# ── Payments ───────────────────────────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# ── Analytics + scraping ───────────────────────────────────────
POSTHOG_KEY=
APIFY_API_KEY=

# ── n8n webhook authentication ─────────────────────────────────
N8N_WEBHOOK_SECRET=
"

write_if_missing ".gitleaks.toml" "# gitleaks configuration — SEC-02
title = \"OpenClaw secret scan\"

[allowlist]
paths = [
  '''\\.env\\.example$''',
  '''docs/.*\\.md$''',
]
"

# Top-level READMEs
write_if_missing "supabase/README.md" "# Supabase

Single source of truth for the OpenClaw database schema (Doc §4, §7).

- \`migrations/\` — ordered SQL files; run via \`pnpm supabase migration up\`.
- \`functions/\` — edge functions (Phase 2+).
- \`seed.sql\` — dev-only fixtures.

## Migration order
1. 0001_init.sql — 15 Layer-1/2/3 tables + RLS + indexes
2. 0002_seed_occasions.sql — Ramadan, Eid, ND, FD × 2028
3. 0003_seed_baselines.sql — F&B / Retail / Beauty_Wellness
4. 0004_perf_indexes.sql
5. 0005_pdpl_cascade.sql — cascade_delete_brand() function
"

write_if_missing "n8n/README.md" "# n8n Workflows

All 11 workflows (Doc §5). Exported monthly as JSON under \`flows/\` (M3 requirement).

| Flow ID  | Trigger                 | Purpose                                           |
|----------|-------------------------|---------------------------------------------------|
| N8N-A01  | Cron (shard 23:00 AST)  | Batch calendar generation — full AI chain         |
| N8N-A02  | Webhook                 | On-demand single-post generation                  |
| N8N-A03  | Webhook                 | Onboarding auto-extraction + BrandDNA v0.1        |
| N8N-A04  | Webhook                 | Brand correction → Memory Controller nomination   |
| N8N-A05  | Cron (1st of month)     | Growth — upgrade readiness alerts                 |
| N8N-B03  | Webhook                 | Revision request                                  |
| N8N-V01  | Sub-flow                | Weavy visual chain + Sharp Arabic overlay         |
| N8N-D02  | Cron (1st of month)     | BrandDNA maintenance + CIO trigger (Phase 2)      |
| N8N-S01  | Cron (15 min)           | Pipeline health check                             |
| N8N-S02  | Event                   | Cost ceiling alerts 70/90/100%                    |
| N8N-S03  | Event                   | Anomaly router                                    |

Every flow must have: trigger + credential ref + error branch (2× retry + backoff) + usage_logs write + N8N-S03 on final fail.
"

write_if_missing "docs/README.md" "# Docs

- \`adr/\` — Architecture Decision Records (one per non-obvious decision — Doc §11.3)
- \`runbooks/\` — incident playbooks
- \`architecture/\` — request flow, BrandDNA layers, phase roadmap
- \`db/\` — schema diagram + migration log
- \`onboarding/\` — dev setup, first-day guide
- \`api/\` — webhook contracts between n8n and Next.js
"

write_if_missing "docs/adr/0001-baseline.md" "# ADR 0001 — Baseline architecture

Status: Accepted
Date: 2026-04-27

## Context
Doc v1.0 defines the Phase 1 baseline. See \`Content_Generation_Platform.pdf\` for the full technical architecture.

## Decision
Adopt the architecture as specified — seven-layer, 4 AI C-Suite agents, Memory Controller single-writer, 3-layer BrandDNA, all 11 n8n flows, 4 Hard Rules enforced in code.

## Consequences
See CHANGELOG.md for subsequent ADRs.
"

write_if_missing "docs/runbooks/incident_weavy_down.md" "# Incident — Weavy down

## Symptoms
- N8N-V01 executions failing with timeout / 5xx.
- qa_review_queue backlog rising.

## Mitigation
1. Confirm Weavy status (status.weavy.ai).
2. Enable fallback image model via env (\`WEAVY_FALLBACK=nano_banana_direct\`).
3. N8N-V01 continues to hold affected posts in QA queue; batch is never failed wholesale.
4. Post-incident: clear held posts once Weavy recovers.
"

write_if_missing "docs/runbooks/env_rotation.md" "# Env variable rotation runbook (M3 requirement — Doc §11.3)

For each env var: current holder, rotation steps, who to notify, rollback.

1. **ANTHROPIC_API_KEY**
   - Generate new key in Anthropic console.
   - Update Vercel env; redeploy.
   - Update n8n credential object.
   - Revoke old key after 24h.
   - Rollback: keep old key active during transition window.

(Repeat for each of the 27 env vars in \`.env.example\`.)
"

write_if_missing "docs/architecture/request_flow.md" "# Request flow — every generation event (Doc §3.2)

Applies to N8N-A01 (batch) and N8N-A02 (on-demand). The chain is identical; only trigger and priority differ.

TRIGGER → n8n → CEO (routing) → COO (CaptionContext) → DeepSeek (20 captions) → CCO (QC) → CEO (confidence gate + 11 override triggers) → N8N-V01 (per non-held post) → assemble calendar → Resend email → CEO (batch completion) → Memory Controller (nominations).
"

write_if_missing "docs/architecture/brand_dna_layers.md" "# BrandDNA — three-layer intelligence (Doc §4)

## Layer 1 — Private Brand
RLS: \`brand_id = auth.uid()\`. Zero cross-brand access.

## Layer 2 — Sector Intelligence
Readable by all agents. Writable by Memory Controller only. Updated monthly by CIO in Phase 2.

## Layer 3 — Global Intelligence
Readable by all authenticated users. Writable by service_role only. Zero foreign keys to brand_profiles.

See \`packages/db/src/schema/\` for table definitions.
"

write_if_missing "docs/architecture/phase_roadmap.md" "# Phase roadmap (Doc §1.3 + §11)

| Phase   | Status    | Features                                                                   |
|---------|-----------|----------------------------------------------------------------------------|
| Phase 1 | BUILD NOW | Onboarding, calendar generation, download delivery, admin + 3 Copilots.    |
| Phase 2 | READY     | Postiz auto-publishing, Meta Insights API, CIO (Gemini) weekly analysis.   |
| Phase 3 | PLANNED   | CARO Arabic QC (Jais/DeepSeek), video/motion chains, competitor analysis.  |
| Phase 4 | PLANNED   | CPO (Claude Code) autonomous content strategy, multi-platform.             |
| Phase 5 | PLANNED   | White-label API for agencies, multi-tenant enterprise, custom brand models.|
| Phase 6 | PLANNED   | Predictive content scoring, real-time performance, Arabic market data.     |

Every Phase 1 architectural decision is made with Phase 6 in mind — additions never require Phase 1 rewrites.
"

write_if_missing "docs/db/README.md" "# Database documentation

- \`schema.dbml\` — dbdiagram.io source
- \`schema.png\` — rendered ERD
- \`migration_log.md\` — per-migration up/down scripts and rationale
"

write_if_missing "docs/onboarding/dev_setup.md" "# Dev setup — first day

1. Install Node 20+, pnpm, Docker, Supabase CLI.
2. \`git clone && cd openclaw-platform && pnpm install\`.
3. \`cp .env.example .env.local\` — get values from team 1Password.
4. \`pnpm supabase start\` — local Postgres + Studio.
5. \`pnpm --filter @openclaw/web dev\` — open http://localhost:3000.
6. Read \`CLAUDE.md\` (4 Hard Rules).
7. Read \`docs/architecture/request_flow.md\`.
"

write_if_missing "docs/api/webhook_contracts.md" "# Webhook contracts (n8n ↔ Next.js)

All webhooks validated with \`N8N_WEBHOOK_SECRET\` header.

## POST /api/webhooks/n8n
Status callbacks from n8n flows.

## POST /api/webhooks/stripe
Stripe checkout + subscription events. Signature verified with \`STRIPE_WEBHOOK_SECRET\` (SEC-10).

## POST /api/webhooks/correction
Client brand correction — forwards to N8N-A04.
"

write_if_missing "tests/README.md" "# Tests

- \`unit/\` — Vitest, pure functions (inside each package)
- \`hard_rules/\` — CI-gating audits of the 4 Hard Rules (inside packages/core)
- \`integration/\` — hit real Supabase test project
- \`e2e/\` — Playwright
- \`load/\` — k6 scripts (100 concurrent, 300-client batch)
- \`arabic_qa/\` — 20-post calibration + 50-post M2 eval set
- \`fixtures/\` — shared test data (F&B Najdi, Retail Hejazi, Beauty Gulf, …)
"

write_if_missing "tests/hard_rules/README.md" "# Hard Rules audit suite

These specs gate every PR merge (see \`.github/workflows/hard-rules.yml\`).

| #  | Rule                                | Spec                                          |
|----|-------------------------------------|-----------------------------------------------|
| 1  | CEO always routes first             | 01_ceo_always_first.spec.ts                   |
| 2  | Memory Controller is only writer    | 02_memory_controller_gate.spec.ts             |
| 3  | No Arabic in image prompts          | 03_arabic_never_in_image_prompts.spec.ts      |
| 4  | No Weavy URLs in DB                 | 04_no_weavy_urls_in_db.spec.ts                |
"

write_if_missing "tests/arabic_qa/README.md" "# Arabic QA eval harness

- \`calibration_20.json\` — small curated set used during CCO bring-up.
- \`eval_50.json\` — formal M2 gate; must reach ≥80% agreement with ground truth.

Run: \`pnpm test:arabic-qa\`.
"

write_if_missing "handover/README.md" "# Handover

Milestone acceptance evidence. Never delete — this is what unlocks OGz payment milestones.

- \`M1_acceptance.md\` — Day 5 (Onboarding E2E)
- \`M2_acceptance.md\` — Day 10 (Full AI chain + visuals)
- \`M3_acceptance.md\` — Day 14–15 (Admin + walkthrough)
- \`access/\` — access audit screenshots (redacted)
"

write_if_missing "scripts/README.md" "# Scripts

Ops and dev utilities (TypeScript, run via \`pnpm tsx\`).

- \`seed_dev_brands.ts\` — create F&B Najdi / Retail Hejazi / Beauty Gulf test brands.
- \`simulate_batch.ts\` — run a shard of N8N-A01 against the dev DB.
- \`hard_rules_audit.ts\` — local runner for the CI gate.
- \`env_rotate.ts\` — follows docs/runbooks/env_rotation.md.
- \`import_n8n_flows.sh\` — push all n8n/flows/*.json to n8n Cloud via API.
"

write_if_missing "project_plan/README.md" "# Project plan

Source of truth lives one level up in \`../../project_plan/\` (the CSVs imported into Google Sheets).
This folder is a workspace-local mirror for scripts/tooling.
"

# ────────────────────────────────────────────────────────────
# 7. Stub package.json files for every new package
# ────────────────────────────────────────────────────────────
write_pkg_json () {
  local pkg_dir="$1"
  local pkg_name="$2"
  local description="$3"
  if [ ! -f "$pkg_dir/package.json" ]; then
    cat > "$pkg_dir/package.json" <<EOF
{
  "name": "$pkg_name",
  "version": "0.0.0",
  "private": true,
  "description": "$description",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0"
  },
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "^5.5.0"
  }
}
EOF
    echo "  + $pkg_dir/package.json"
  fi
}

write_tsconfig () {
  local pkg_dir="$1"
  local base="$2"
  if [ ! -f "$pkg_dir/tsconfig.json" ]; then
    cat > "$pkg_dir/tsconfig.json" <<EOF
{
  "extends": "@repo/typescript-config/$base",
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
EOF
    echo "  + $pkg_dir/tsconfig.json"
  fi
}

write_index () {
  local pkg_dir="$1"
  if [ ! -f "$pkg_dir/src/index.ts" ]; then
    echo "// public API — re-export here when modules exist" > "$pkg_dir/src/index.ts"
    echo "  + $pkg_dir/src/index.ts"
  fi
}

# Existing placeholder packages — give them real manifests if missing
declare -A EXISTING_PKGS=(
  ["packages/core"]="@repo/core|Domain model, types, schemas, confidence classifier, 11 override triggers"
  ["packages/db"]="@repo/db|Supabase access \\u2014 typed queries only"
  ["packages/email"]="@repo/email|React Email templates (Arabic RTL) + Resend wrapper"
  ["packages/n8n"]="@repo/n8n|n8n workflow helpers + exported flow JSONs"
  ["packages/shared"]="@repo/shared|Cross-cutting helpers, errors, constants"
)

for pkg_dir in "${!EXISTING_PKGS[@]}"; do
  IFS='|' read -r name desc <<< "${EXISTING_PKGS[$pkg_dir]}"
  write_pkg_json "$pkg_dir" "$name" "$desc"
  write_tsconfig "$pkg_dir" "base.json"
  write_index "$pkg_dir"
done

# New packages
declare -A NEW_PKGS=(
  ["packages/ai"]="@repo/ai|AI C-Suite wrappers (CEO/COO/CCO/DeepSeek) + prompt loader"
  ["packages/memory"]="@repo/memory|Memory Controller \\u2014 sole BrandDNA writer"
  ["packages/image"]="@repo/image|Weavy client + Sharp Arabic overlay + Supabase Storage helper"
  ["packages/vectors"]="@repo/vectors|Qdrant wrapper (per-brand namespaces)"
  ["packages/scraping"]="@repo/scraping|Apify Instagram + website + Google Places"
  ["packages/payments"]="@repo/payments|Stripe checkout + tier gate"
  ["packages/pdpl"]="@repo/pdpl|PDPL cascade delete (Phase 1 + async Phase 2)"
  ["packages/analytics"]="@repo/analytics|PostHog events"
  ["packages/auth"]="@repo/auth|Client + admin auth guards, copilot JWT claims"
  ["packages/i18n"]="@repo/i18n|Arabic / English locale bundles"
  ["packages/config"]="@repo/config|Zod-validated env loader, dialect / platform / sector maps"
  ["packages/utils"]="@repo/utils|Arabic unicode guard, Hijri dates, Arabic slug transliteration"
)

for pkg_dir in "${!NEW_PKGS[@]}"; do
  IFS='|' read -r name desc <<< "${NEW_PKGS[$pkg_dir]}"
  write_pkg_json "$pkg_dir" "$name" "$desc"
  write_tsconfig "$pkg_dir" "base.json"
  write_index "$pkg_dir"
done

# ────────────────────────────────────────────────────────────
# 8. Deployable stubs (services + future apps)
# ────────────────────────────────────────────────────────────
write_pkg_json "services/pdpl-janitor" "@openclaw/pdpl-janitor" "Phase 1 — hourly retry of failed PDPL Phase 2 deletes (Doc §7.4)"
write_tsconfig "services/pdpl-janitor" "base.json"
if [ ! -f "services/pdpl-janitor/src/index.ts" ]; then
  cat > services/pdpl-janitor/src/index.ts <<'EOF'
// OpenClaw — PDPL Phase 2 cleanup janitor (Doc §7.4)
// Scans deletion_audit_log for phase2_complete=false; retries Qdrant + Storage cleanup.
// Alerts admin if unresolved within 1h; continues retrying every 5 min for 24h.
export async function run(): Promise<void> {
  throw new Error("pdpl-janitor: implement in sprint S8.08");
}
EOF
fi

write_pkg_json "services/cio-analyzer" "@openclaw/cio-analyzer" "Phase 2 stub — weekly CIO (Gemini 2.5 Pro) pattern analysis"
write_tsconfig "services/cio-analyzer" "base.json"
if [ ! -f "services/cio-analyzer/src/index.ts" ]; then
  cat > services/cio-analyzer/src/index.ts <<'EOF'
// OpenClaw — CIO weekly analyzer (Phase 2 only; do not deploy in Phase 1)
// Reads Layer 2 + Layer 3 tables; proposes new onboarding_questions and sector baseline updates.
export async function run(): Promise<void> {
  throw new Error("cio-analyzer: Phase 2 placeholder");
}
EOF
fi

write_pkg_json "services/generation-worker" "@openclaw/generation-worker" "Phase 3 stub — dedicated AI chain worker (Doc §5.5)"
write_tsconfig "services/generation-worker" "base.json"
if [ ! -f "services/generation-worker/src/index.ts" ]; then
  cat > services/generation-worker/src/index.ts <<'EOF'
// OpenClaw — dedicated generation worker (Phase 3 only; n8n calls packages directly in Phase 1)
// Activated when brand count > 2000 (Doc §5.5).
export async function run(): Promise<void> {
  throw new Error("generation-worker: Phase 3 placeholder");
}
EOF
fi

write_pkg_json "apps/agency-api" "@openclaw/agency-api" "Phase 5 stub — white-label public API for agencies"
write_tsconfig "apps/agency-api" "base.json"
if [ ! -f "apps/agency-api/src/index.ts" ]; then
  cat > apps/agency-api/src/index.ts <<'EOF'
// OpenClaw — white-label public API (Phase 5 only; do not deploy in Phase 1)
// Adds API-key auth middleware on top of the same @openclaw/* packages used by apps/web.
export async function start(): Promise<void> {
  throw new Error("agency-api: Phase 5 placeholder");
}
EOF
fi

write_pkg_json "apps/admin-cli" "@openclaw/admin-cli" "Ops CLI \\u2014 seed, simulate, rotate, hard-rules audit"
write_tsconfig "apps/admin-cli" "base.json"
if [ ! -f "apps/admin-cli/src/index.ts" ]; then
  cat > apps/admin-cli/src/index.ts <<'EOF'
// OpenClaw — admin CLI entrypoint
// Usage: pnpm --filter @openclaw/admin-cli tsx src/index.ts <command>
export async function main(argv: string[]): Promise<void> {
  console.log("admin-cli", argv);
}
EOF
fi

# Service + future-app READMEs
write_if_missing "services/pdpl-janitor/README.md" "# pdpl-janitor (Phase 1 — required)

Hourly job that retries failed PDPL Phase 2 cleanups (Qdrant namespace delete + Supabase Storage folder delete). Alerts admin if unresolved >1h. See Doc §7.4.
"
write_if_missing "services/cio-analyzer/README.md" "# cio-analyzer (Phase 2 — stub only)

Do not deploy in Phase 1. Will run weekly Gemini 2.5 Pro analysis across Layer 2 + Layer 3 once Phase 2 begins.
"
write_if_missing "services/generation-worker/README.md" "# generation-worker (Phase 3 — stub only)

Do not deploy in Phase 1. Extracted AI chain service activated when brand count > 2000 (Doc §5.5).
"
write_if_missing "apps/agency-api/README.md" "# agency-api (Phase 5 — stub only)

Do not deploy in Phase 1. White-label public API with API-key auth on top of the same shared packages.
"
write_if_missing "apps/admin-cli/README.md" "# admin-cli

Ops-only CLI. Commands: seed, simulate, rotate, hard-rules audit.
"

# ────────────────────────────────────────────────────────────
# 9. GitHub workflows (CI gates)
# ────────────────────────────────────────────────────────────
write_if_missing ".github/workflows/ci.yml" "name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run typecheck lint build test
"

write_if_missing ".github/workflows/hard-rules.yml" "name: Hard Rules

on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run hard-rules
"

write_if_missing ".github/workflows/secret-scan.yml" "name: Secret scan

on: [push, pull_request]

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
"

# ────────────────────────────────────────────────────────────
# 10. Milestone acceptance stubs
# ────────────────────────────────────────────────────────────
for m in M1 M2 M3; do
  write_if_missing "handover/${m}_acceptance.md" "# $m Acceptance

Criteria from \`../project_plan/03_Milestones.csv\` (row: $m).

## Evidence
- [ ] Link to CI run with all checks green
- [ ] Screenshots / video demo
- [ ] OGz sign-off (signed email or signed PDF)

## Sign-off
Signed: _______________
Date:   _______________
"
done

echo ""
echo "✓ Bootstrap complete. Re-run any time — it is idempotent."
