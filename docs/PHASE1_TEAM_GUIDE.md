# OGz Studios — Phase 1 Team Guide

> **Audience:** Lead + Dev 2 + Dev 3.
> **Purpose:** Single source of truth for (a) where APIs live, (b) how client/server talk to them, (c) how the remaining Phase 1 work is divided so all three can ship in parallel without blocking each other.
> **Pairs with:** `docs/auth-foundation.md` (auth + RLS), `CLAUDE.md` (4 hard rules), `doc.txt` (full architecture spec), `project_plan/01_Master_Plan.csv` (61 sprints).

---

## 1. Where APIs Live (current foundation)

OGz Studios uses **three integration patterns** depending on the use case. Pick the right one — don't invent new ones.

### 1.1 Folder map

```
apps/web/src/
├── app/
│   ├── actions/            ← Server Actions ('use server')   ┐
│   │   ├── apply.ts                                         │  PATTERN A:
│   │   ├── locale.ts                                        │  Browser → form → server action
│   │   ├── onboarding.ts                                    │  (FormData in, redirect/result out)
│   │   ├── qa.ts                                            │
│   │   └── settings.ts                                      ┘
│   │
│   ├── api/                ← Route Handlers (route.ts)       ┐
│   │   ├── admin/auth/                                      │  PATTERN B:
│   │   │   ├── login/route.ts                               │  Browser → fetch JSON → route
│   │   │   └── logout/route.ts                              │  (JSON in, JSON out)
│   │   ├── auth/callback/route.ts          (OAuth callback) │  Also used for:
│   │   ├── copilot/[role]/route.ts         (chat endpoint)  │  - Webhooks (signed by 3rd party)
│   │   └── webhooks/                                        │  - n8n callbacks
│   │       ├── correction/route.ts                          │
│   │       ├── n8n/route.ts                                 │
│   │       └── stripe/route.ts                              ┘
│   │
│   ├── [slug]/             ← server components, query DB    ┐
│   ├── admin/                directly via @repo/db/queries  │  PATTERN C:
│   └── (marketing)/                                         │  Server component → @repo/db
│                                                            ┘  (no HTTP, no JSON)
│
├── components/auth/        ← form components ('use client')
├── hooks/                  ← useApiMutation, useLogin, useAdminLogin
└── lib/api/                ← fetch helpers (ApiError, apiFetch, types)

packages/
├── auth/src/               ← @repo/auth — auth helpers (client/server/admin/proxy/slug)
├── db/src/                 ← @repo/db — Supabase client factories + typed queries
└── ui/src/                 ← @repo/ui — design system primitives
```

### 1.2 The three patterns at a glance

| Pattern | When to use | Browser side | Server side | Auth |
|---|---|---|---|---|
| **A. Server Action** | Forms, mutations triggered by user clicks (login/onboarding/settings/QA approve/reject) | `<form onSubmit>` calls action via i`useTransition` | `'use server'` exported async fn taking `FormData` | Auto: `requireUser()` / `requireAdmin()` nside the action |
| **B. Route Handler (`api/*/route.ts`)** | OAuth callbacks, webhooks (Stripe, n8n), JSON APIs that need a stable URL | `apiFetch()` wraps `fetch()` w/ JSON conventions | `route.ts` exports `GET`/`POST` etc. | Custom: webhook signature verify, or Supabase JWT |
| **C. Direct DB (server component)** | Reading data for a page (dashboards, calendars, lists) | N/A — server-rendered | `import { brandsQ, calendarsQ } from '@repo/db/queries/*'` in the page/layout | RLS via user-scoped client |

**Rule of thumb:** if it's a **read for a page**, use pattern C. If it's a **user-triggered mutation**, use pattern A. If it's an **external system calling us** (webhook, OAuth provider, n8n), use pattern B.

---

## 2. Pattern A — Server Actions (the default for our forms)

### 2.1 Anatomy

**Server side** (`apps/web/src/app/actions/<feature>.ts`):
```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { serverComponentClient } from '@repo/db/client'
import { requireUser, getBrandForCurrentUser } from '@repo/auth/server'

export interface MyActionResult {
  ok: boolean
  error?: string
  message?: string
}

async function userClient() {
  const store = await cookies()
  return serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try { for (const c of toSet) store.set(c.name, c.value, c.options) } catch {}
    },
  })
}

export async function submitMyForm(slug: string, formData: FormData): Promise<MyActionResult> {
  await requireUser({ next: `/${slug}/something` })           // 1. Auth gate
  const brand = await getBrandForCurrentUser(slug)            // 2. Ownership check
  if (!brand) return { ok: false, error: 'not_found' }

  const value = String(formData.get('field') ?? '').trim()    // 3. Validate
  if (!value) return { ok: false, error: 'field is required' }

  const supabase = await userClient()                         // 4. User-scoped client (RLS)
  const { error } = await supabase.from('some_table').insert({ /* … */ })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/${slug}/something`)                        // 5. Bust the cache
  return { ok: true, message: 'Saved.' }
}
```

**Browser side** (`apps/web/src/app/[slug]/something/my-form.tsx`):
```tsx
'use client'
import { useState, useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { submitMyForm, type MyActionResult } from '@/app/actions/my-feature'

export function MyForm({ slug }: { slug: string }) {
  const [state, setState] = useState<MyActionResult | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => setState(await submitMyForm(slug, fd)))
  }

  return (
    <form onSubmit={onSubmit}>
      {/* fields */}
      {state && !state.ok && <p className="text-(--danger)">{state.error}</p>}
      {state?.ok && <p className="text-(--accent)">{state.message}</p>}
      <Button type="submit" disabled={pending}>{pending ? '…' : 'Save'}</Button>
    </form>
  )
}
```

### 2.2 Examples already shipped (use as templates)

| Action | Trigger | Auth | DB writes |
|---|---|---|---|
| `actions/onboarding.ts` `submitOnboarding` | `/onboarding-start` form submit | `requireUser()` | `brand_profiles` (RLS via user-scoped client) + `source_records` |
| `actions/settings.ts` `updateProfile/changePassword/updateNotifications/requestAccountDeletion` | `/{slug}/settings` | `requireUser()` + `getBrandForCurrentUser` | `auth.users` user_metadata, `override_rules`, `deletion_audit_log` |
| `actions/qa.ts` `approveQaItem/rejectQaItem` | `/admin/qa` button click | `requireAdmin()` | `qa_review_queue.status` + `usage_logs` audit |
| `actions/locale.ts` `setLocaleAction` | Locale toggle | none | cookie write |

### 2.3 Conventions (follow these)

1. **Always return `{ ok: boolean, error?, message? }`.** Never throw to the client unless you mean to (the form code unwraps `state.error` cleanly).
2. **Auth FIRST.** Call `requireUser` / `requireBrandAccess` / `requireAdmin` before anything else — never trust the proxy alone.
3. **Validate INPUTS strictly.** Use `Set<string>` for enum membership. Reject anything not in the allowed values. Never insert raw `formData.get()` without checks.
4. **Use the user-scoped client (`serverComponentClient`)** for DB writes that should respect RLS. Only use `adminClient()` for service-role tasks (cron, internal jobs) — and only when you have a real service-role key.
5. **`revalidatePath()` after writes** so the next render sees fresh data.
6. **`redirect()` only when navigation is the desired result** (e.g., onboarding → processing). Don't redirect from inside a form expecting a result.

---

## 3. Pattern B — Route Handlers (`api/*/route.ts`)

### 3.1 When to use

- OAuth callback (`/api/auth/callback`) — Supabase redirects here with a `code`
- Admin auth (`/api/admin/auth/login`, `/api/admin/auth/logout`) — sets custom httpOnly cookies
- Webhooks (`/api/webhooks/stripe`, `/api/webhooks/n8n`, `/api/webhooks/correction`) — verified by signature, not by user session
- Copilot chat (`/api/copilot/[role]`) — needs a stable URL the frontend hits with conversation history

### 3.2 Server side (template)

```ts
// apps/web/src/app/api/widgets/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@repo/auth/server'

export async function POST(request: NextRequest) {
  const user = await requireUser({ next: '/widgets' })
  const body = (await request.json().catch(() => null)) as { name?: string } | null
  if (!body?.name) {
    return NextResponse.json({ message: 'name is required' }, { status: 400 })
  }

  // … do work …

  return NextResponse.json({ ok: true, widget: { id: '…', name: body.name } })
}
```

### 3.3 Browser side — use `apiFetch` (DON'T raw-`fetch`)

`apps/web/src/lib/api/http.ts` already provides:
```ts
import { apiFetch, ApiError } from '@/lib/api'

const result = await apiFetch<{ ok: true; widget: Widget }>('/api/widgets', {
  method: 'POST',
  body: JSON.stringify({ name }),
})
```

Why:
- Adds `Content-Type: application/json` automatically
- Throws an `ApiError` (with `.message`, `.code`, `.details`) on non-2xx, so the catch site has a stable error shape
- One place to add cross-cutting concerns later (auth header, telemetry)

Wrap each call in a typed helper in `lib/api/<feature>.ts`:
```ts
// lib/api/widgets.ts
'use client'
import { apiFetch } from './http'

export async function createWidget(input: { name: string }) {
  return apiFetch<{ ok: true; widget: { id: string; name: string } }>(
    '/api/widgets',
    { method: 'POST', body: JSON.stringify(input) },
  )
}
```

Then expose it via a hook (`apps/web/src/hooks/use-widget.ts`):
```ts
'use client'
import { useApiMutation } from './use-api-mutation'
import { createWidget } from '@/lib/api/widgets'

export function useCreateWidget() {
  return useApiMutation(createWidget)   // .mutateAsync, .isPending, .error, .reset
}
```

### 3.4 Authentication patterns by route type

| Route type | Auth approach | Example |
|---|---|---|
| User-facing API (POST a thing) | `await requireUser()` at top of handler | `/api/widgets` |
| Admin-only API | `await requireAdmin()` at top of handler | future `/api/admin/foo` |
| Webhook from external service | Verify signature header against env secret BEFORE doing anything else | Stripe: `STRIPE_WEBHOOK_SECRET`; n8n: `N8N_WEBHOOK_SECRET` |
| OAuth callback | Exchange `code` via `supabase.auth.exchangeCodeForSession`, set cookies via `createServerClient` | `/api/auth/callback` |

---

## 4. Pattern C — Direct DB in server components

For dashboards, lists, detail pages: **don't make an API call to your own backend**. Just import the typed query and `await` it.

```tsx
// apps/web/src/app/[slug]/dashboard/page.tsx
import { brandsQ, calendarsQ } from '@repo/db'
import { requireBrandAccess } from '@repo/auth/server'

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { brand } = await requireBrandAccess(slug)
  const calendars = await calendarsQ.listForBrand(brand.brand_id)

  return <CalendarList rows={calendars} />
}
```

Query helpers live in `packages/db/src/queries/`:
- `brands.ts` — `getBrandBySlug`, `getAllBrands`, `getEvidenceBundlesForBrand`
- `calendars.ts` — calendar lists, posts
- `admin.ts` — QA queue, anomalies, routing decisions, usage logs
- `occasions.ts` — Saudi occasion calendar
- `snapshots.ts` — brand snapshots

Add new query files here when a feature needs reads. **Never inline raw Supabase calls in pages** — pages should be thin and call typed query helpers.

---

## 5. Auth — three subpath imports

```ts
// In a 'use client' file (forms, buttons)
import { signInWithPassword, signOut, signInWithOAuth } from '@repo/auth/client'

// In a server component, server action, or route handler
import { requireUser, requireBrandAccess, getCurrentUser } from '@repo/auth/server'

// In an admin server component or admin action
import { requireAdmin, isAdminPrincipal } from '@repo/auth/admin'

// Anywhere
import { generateSlug } from '@repo/auth/slug'
```

JWT-based, two layers:
1. **`apps/web/src/proxy.ts`** refreshes the Supabase session cookies on every request and redirects unauthenticated users.
2. **Server-side guards** re-verify in every layout, server action, and route handler. Per Next.js 16 docs, server functions are not separate routes — a proxy matcher change can silently move them out of coverage. Belt + braces.

---

## 6. RLS — the contract every dev must respect

Every table has Row-Level Security ON. The policies follow a consistent shape:

| Table family | SELECT | INSERT | UPDATE | DELETE | Service role |
|---|---|---|---|---|---|
| `brand_profiles` | `auth_user_id = auth.uid()` | same | same | (none) | bypasses |
| Layer 1 children (audience/visual/channel/evidence/source/negative/override/onboarding/perf/snapshots) | brand owned by `auth.uid()` | same | same | (none) | bypasses |
| Append-only (`routing_decisions`, `branddna_event_log`) | own brand | INSERT only | blocked | blocked | bypasses |
| `deletion_audit_log` | own brand | own brand | (none) | (none) | bypasses |
| Layer 2 (sector_*) | authenticated read | (none) | (none) | (none) | bypasses |
| Layer 3 (global_*) | authenticated read | (none) | (none) | (none) | bypasses |

**For developers:** when you write a server action that touches a Layer 1 table, use the **user-scoped** Supabase client (`serverComponentClient`). RLS will accept the operation iff the user owns the brand. Never use `adminClient()` to "bypass and check ownership in app code" — that's exactly the bug we hit during onboarding before migration 0007.

---

## 7. Phase 1 Work Division — three lanes that don't block each other

### 7.1 The big picture (what's left to ship M1 → M2 → M3)

| Track | Owner | Scope |
|---|---|---|
| **Intelligence** | **Lead (Usama)** | n8n flows × 11, AI C-Suite (CEO/COO/CCO/DeepSeek), Memory Controller, BrandDNA writes, Qdrant vectors, system architecture |
| **Frontend & Integrations** | **Dev 2** | Real wiring of all client + admin pages to live data, Stripe checkout, Resend templates, PostHog instrumentation, Copilot chat UIs, error/loading polish |
| **Backend & Visual** | **Dev 3** | Weavy chain, Sharp Arabic overlay, Supabase Storage, scrapers (Apify + website + Google Places), N8N-V01, load testing |

These three tracks can move in parallel. The contracts between them are stable (HTTP / DB rows / Storage URLs) — see §7.5.

### 7.2 Lead (Usama) — Intelligence Pipeline

Owns the AI brain. Talks to Frontend via `usage_logs` / `routing_decisions` reads + n8n webhooks. Talks to Visual via N8N-V01 sub-flow.

**Folders:**
```
packages/ai/src/
├── providers/
│   ├── ceo.ts            (Claude Sonnet 4.6)
│   ├── coo.ts            (Claude Haiku 4.5)
│   ├── cco.ts            (GPT-5 / GPT-4o fallback)
│   └── deepseek.ts       (DeepSeek V3)
├── schemas/              (Zod validation per agent output)
└── prompts/              (env-var loaders — SEC-06)

packages/memory/src/
├── nominations/          (queue processor)
├── writers/              (the ONLY code allowed to write Layer 1 tables)
└── log/                  (branddna_event_log appender)

packages/vectors/src/     (Qdrant client + namespaces)

n8n/flows/
├── A01_batch.json
├── A02_on_demand.json
├── A03_onboarding.json
├── A04_correction.json
├── A05_upgrade_check.json
├── B03_revision.json
├── V01_visual.json     (Dev 3 builds the Weavy node, Lead wires the call)
├── D02_maintenance.json
├── S01_health.json
├── S02_cost.json
└── S03_anomaly.json

services/
├── generation-worker/
└── cio-analyzer/        (Phase 2 stub, Lead defines interface)
```

**Phase 1 deliverables (per master plan):**
1. `@repo/ai` provider wrappers — structured JSON outputs with Zod validation; prompt caching on COO briefs.
2. `@repo/memory` Memory Controller — process `memory_controller_queue`, validate nominations, atomic writes to Layer 1 + append to `branddna_event_log`.
3. All 11 n8n flows with: trigger + credential refs + 2× retry + backoff + `usage_logs` write + N8N-S03 on final fail (the mandatory pattern).
4. CEO routing 8-step protocol + 11 human-override triggers + Confidence Gate.
5. CCO Arabic QC integration + 50-post evaluation set.
6. Qdrant per-brand namespaces + CaptionContext cache.
7. `services/generation-worker` for parallel batch (M2).

**Won't touch:** UI files in `apps/web/src/app/` (Dev 2's lane), image generation in `packages/image/` (Dev 3's lane).

**Hard rules to respect:** All 4 in `CLAUDE.md`, especially #1 (CEO always routes first) and #2 (Memory Controller is sole BrandDNA writer).

### 7.3 Dev 2 — Frontend & Integrations

Owns the user-visible experience. Talks to backend via the three patterns above.

**Folders:**
```
apps/web/src/
├── app/
│   ├── [slug]/                 (7 client screens — UI exists, wire data + actions)
│   │   ├── dashboard/
│   │   ├── snapshot/
│   │   ├── processing/         (Supabase realtime subscription needs polish)
│   │   ├── calendar/
│   │   ├── calendar/[month]/
│   │   ├── profile/
│   │   ├── settings/           (forms wired ✓ — verify w/ live RLS)
│   │   └── upgrade/            (Stripe Checkout link is the next step)
│   ├── admin/                  (16 views — UIs exist, wire actions)
│   │   ├── qa/                 (approve/reject wired ✓)
│   │   ├── cost/, anomalies/, routing/, flows/, baselines/, occasions/
│   │   ├── clients/[brand_id]/
│   │   ├── branddna/[brand_id]/
│   │   └── copilot/{management,tech,production}/   (chat UIs — backend = Lead)
│   ├── (marketing)/            (apply form wired ✓ — pricing/contact/legal polish)
│   ├── (auth)/                 (login/signup wired ✓ — verify Google OAuth in Supabase dashboard)
│   ├── api/
│   │   └── webhooks/stripe/route.ts   (S6.05 — implement signature verify + tier upgrade)
│   └── actions/                (add new actions per feature)
├── components/                 (forms, charts, copilot chat client)
├── hooks/                      (one per feature; thin wrappers over useApiMutation)
└── lib/api/                    (one per feature; uses apiFetch)

packages/email/src/             (6 Resend templates — Arabic RTL)
packages/payments/src/          (Stripe checkout session + webhook handler)
packages/analytics/src/         (PostHog events)
```

**Phase 1 deliverables:**
1. Wire every server-component page to **real data** via `@repo/db/queries` (currently many show placeholder data — replace with live).
2. **Stripe checkout** in `/{slug}/upgrade`: server action creates checkout session; webhook `/api/webhooks/stripe/route.ts` verifies signature with `STRIPE_WEBHOOK_SECRET` (SEC-10), updates `brand_profiles.tier`.
3. **Resend templates** + send hooks: welcome, calendar_ready, revision_ready, upgrade_success, correction_received, anomaly.
4. **Processing screen** (`/{slug}/processing`) — Supabase realtime subscription on `brand_snapshots` + 10-minute timeout fallback.
5. **Brand correction flow** (`/{slug}/profile` → Flag → server action → POST to N8N-A04 webhook).
6. **Copilot chat UIs** (3 roles) — fetch from `/api/copilot/[role]` (Lead implements the backend).
7. **PostHog** instrumentation on key funnel events (signup, onboarding submit, calendar viewed, upgrade clicked).
8. **Loading + error states** — every page has `loading.tsx` + `error.tsx` consistent with the design system.
9. **Auth UX polish** — "wrong password" error display, password reset flow (Supabase reset email).

**Won't touch:** `packages/ai/`, `packages/memory/`, `packages/image/`, `n8n/flows/` (Lead + Dev 3 lanes).

**Conventions to follow:**
- Form mutations → Pattern A (server action). One file in `app/actions/<feature>.ts`.
- External APIs → Pattern B. One file in `lib/api/<feature>.ts` + one hook in `hooks/use-<feature>.ts`.
- Page reads → Pattern C. Add to `packages/db/src/queries/<feature>.ts` if needed.
- Always import design system pieces from `@repo/ui` — no inline Tailwind for shared widgets.
- Always wrap UI strings in `t('namespace.key')` from `@repo/i18n`. Add new keys to **both** `ar.json` and `en.json` (Dictionary type comes from ar.json).

### 7.4 Dev 3 — Backend Visual + Scrapers

Owns the image pipeline + data ingestion. Talks to Lead via N8N-V01 sub-flow + Storage URLs.

**Folders:**
```
packages/image/src/
├── weavy_client/         (REST wrapper — ONLY file allowed to call Weavy API per CLAUDE.md)
├── arabic_overlay/       (Sharp + dialect font map: Najdi/Hejazi → NotoNaskh, Gulf → Cairo)
├── safe_zones/           (Instagram bottom-third, Snapchat top+bottom)
├── watermark/            (Beta AI draft overlay — 30% opacity, top-right)
├── storage_paths/        (helpers — enforce /clients/{brand_id}/calendars/{YYYY-MM}/{post_id}.jpg)
└── pipeline.ts           (orchestrates: generate → palette lock → overlay → safe zone → watermark → upload)

packages/scraping/src/
├── apify/                (Instagram last-30 posts)
├── website/              (HTTP fetch → Puppeteer fallback → graceful Cloudflare skip)
└── google_places/        (category, rating, reviews)

n8n/flows/V01_visual.json (you build the nodes; Lead wires it from A01/A02)
tests/load/               (300-client simulation — M2 sign-off)
tests/arabic_qa/          (50-post Arabic eval set runner)
```

**Phase 1 deliverables:**
1. **N8N-V01** end to end: 10 nodes per Doc §3.3 (Trigger → Switch → Model select → Generate → Palette lock → Sharp overlay → Safe zone → Watermark → Download → Return Supabase URL).
2. **Hard rule #3 enforcement** at compile time: TypeScript types reject Arabic strings on Weavy inputs (use a branded `EnglishOnlyString` type).
3. **Hard rule #4 enforcement**: `lib/storage_paths.ts` rejects any URL that isn't a Supabase Storage URL when persisting.
4. **Three scrapers** for N8N-A03 onboarding parallel block:
   - Apify Instagram actor (30 posts + engagement)
   - Multi-strategy website scraper (HTTP → Puppeteer fallback → skip)
   - Google Places API (rating, reviews, category)
5. **Sharp dialect-aware font map** with the 4 Arabic fonts, palette-driven color overlay.
6. **Load test** at M2 — 300 clients in <6h batch, p95 latency report.
7. **Storage seeding** — sample brand assets for the 3 demo brands.

**Won't touch:** `apps/web/src/app/` (Dev 2), `packages/ai/`, `packages/memory/` (Lead).

**Hard rules to respect:** #3 (no Arabic in image prompts) and #4 (no Weavy URLs in DB) — these are CI-enforced.

### 7.5 The contracts between the three (this is what unblocks parallel work)

Stable interfaces only — once these are agreed, each dev can move without waiting on the others.

#### A. Frontend ↔ Intelligence

| What | Contract |
|---|---|
| Onboarding form submit | Frontend writes `brand_profiles` + `source_records` (Pattern A, RLS). Lead's N8N-A03 picks up via webhook trigger and continues. |
| Brand correction | Frontend POSTs to `N8N_CORRECTION_WEBHOOK_URL` (env var). Payload: `{brand_id, field, new_value, reason}`. |
| Cost/anomaly admin pages | Frontend reads `usage_logs` / `anomaly_records` via `@repo/db/queries/admin.ts`. Lead writes them. |
| Copilot chat | Frontend POSTs to `/api/copilot/[role]` with `{message, history}`. Lead implements the route handler (Claude Sonnet 4.6 + role-scoped context). |

#### B. Intelligence ↔ Visual

| What | Contract |
|---|---|
| Image generation | Lead's N8N-A01/A02 calls **N8N-V01** (Dev 3's sub-flow) with `WeavyVisualContext` JSON. V01 returns `supabase_storage_url`. |
| Storage paths | Dev 3 enforces `/clients/{brand_id}/calendars/{YYYY-MM}/{post_id}.jpg`. Lead writes the URL to `calendar_posts.image_url`. |
| Watermark flag | Lead sets `confidence_flag` in V01 input. Dev 3 applies overlay if `watermark_required`. |

#### C. Frontend ↔ Visual

| What | Contract |
|---|---|
| Calendar dashboard images | Frontend reads `calendar_posts.image_url` (Supabase Storage URL). Dev 3 guarantees that's a real, signed-URL-able path. |
| Logo upload (onboarding) | Frontend uploads to Storage at `/clients/{brand_id}/logo.png` via Supabase Storage SDK. Dev 3 owns the bucket + transform rules. |

---

## 8. Folder structure rules everyone follows

1. **Don't put feature code in `apps/web/src/lib/` if it's reusable.** Put it in a workspace package (`packages/<thing>`). Only Next-specific glue lives in `apps/web/src/lib/`.
2. **Subpath exports.** Every workspace package uses `exports` in `package.json` (`@repo/auth/client`, `@repo/auth/server`, etc.) so importers stay clean and bundles stay small.
3. **`'use client'` boundary is sacred.** Anything imported from a `'use client'` file gets bundled to the browser. NEVER import server-only code (`@repo/auth/admin`, `@repo/auth/server`, `@repo/db/client.adminClient`) from a client component.
4. **`'server-only'` package.** Files that must never reach the browser start with `import 'server-only'` — Next.js will throw at build time if they're imported into a client bundle.
5. **One feature, one folder.** New feature = `app/actions/<feature>.ts` + `lib/api/<feature>.ts` (if needed) + `hooks/use-<feature>.ts` + `components/<feature>/*.tsx`. Don't sprawl.
6. **Migrations are append-only.** Add `0009_*.sql`, `0010_*.sql` — never edit a committed migration. Run `pnpm db:types` after every migration to keep `database.types.ts` in sync.
7. **i18n strings in JSON only.** No hardcoded English/Arabic in components. Add to `packages/i18n/src/locales/{ar,en}.json`. Type derives from `ar.json` (Dictionary).
8. **No raw Supabase calls in pages.** Wrap them in `packages/db/src/queries/<feature>.ts` and import the typed function.
9. **Tests live at the workspace root.** `tests/<area>/<feature>.test.ts`. Run via `pnpm test`.
10. **No secrets in code.** Env vars only. CI runs gitleaks — secrets in commits will be rejected.

---

## 9. Daily workflow per developer

### 9.1 Setup (one-time)

```bash
git clone <repo> && cd openclaw-platform
pnpm install
cp .env.example .env.local            # fill in Supabase + AI keys
pnpm db:setup                          # migrate + seed + verify
pnpm db:create-admin -- you@yours.com 'StrongPass!'
pnpm --filter web dev                  # opens http://localhost:3000
```

### 9.2 Per feature

```bash
# 1. Pull main
git pull origin main

# 2. Branch
git checkout -b feature/<short-name>

# 3. Code (your lane only — don't cross into another dev's territory)
# 4. Local checks
pnpm check-types       # turbo runs all packages
pnpm test              # vitest
pnpm --filter web lint

# 5. Commit (descriptive, present-tense)
git add -p
git commit -m "feat(qa): wire approve/reject to qa_review_queue"

# 6. PR — CI runs typecheck, lint, hard-rules audit, gitleaks
```

### 9.3 When schema changes

```bash
# 1. Add migration
echo "/* … */" > supabase/migrations/0009_my_change.sql

# 2. Apply + regenerate types
pnpm db:migrate
pnpm db:types          # rewrites packages/db/src/schema/database.types.ts

# 3. Commit BOTH the migration AND the regenerated types
```

### 9.4 When env requirements change

Update **both** `.env.example` (placeholder) **and** `docs/auth-foundation.md` (workflow section). Don't put real secrets in `.env.example`.

---

## 10. Milestone gates (payment-gated handover per master plan)

| Gate | Date | Acceptance criteria | Who signs off |
|---|---|---|---|
| **M0** | Day 2 | Schema + seeds + scaffold | Lead |
| **M1** | Day 5 | E2E: form → snapshot in <5 min | Lead + Dev 2 |
| **M2** | Day 10 | Full AI chain + 300-client load test + Memory Controller live | All three |
| **M3** | Day 14 | Admin views + Visual chain + 3 Copilots + n8n READMEs | All three |
| **M3+** | Day 15 | Walkthrough, credential rotation, prompt deletion confirmed | All three + OGz |

Use `handover/M{1,2,3}_acceptance.md` to record evidence.

---

## 11. Quick reference — "where do I add X?"

| Need | Location | Pattern |
|---|---|---|
| New form on a client page | `app/actions/<feature>.ts` + `app/[slug]/<page>/<form>.tsx` | A |
| New form on a public page | `app/actions/<feature>.ts` + `app/(marketing)/<page>/<form>.tsx` | A |
| New admin action | `app/actions/<feature>.ts` (gated by `requireAdmin()`) + `app/admin/<page>/<button>.tsx` | A |
| New webhook from external system | `app/api/webhooks/<service>/route.ts` (verify signature first) | B |
| New JSON API for an external integration partner | `app/api/<feature>/route.ts` | B |
| New page that displays existing data | `packages/db/src/queries/<feature>.ts` + page imports it | C |
| New AI agent / n8n flow logic | `packages/ai/src/providers/<agent>.ts` + n8n flow | Lead |
| New image transform | `packages/image/src/<step>/` | Dev 3 |
| New i18n string | `packages/i18n/src/locales/{ar,en}.json` | — |
| New shared component | `packages/ui/src/<component>.tsx` (export via package.json) | — |
| New table | `supabase/migrations/00XX_<change>.sql` + `pnpm db:types` | — |
| New env var | `.env.example` (placeholder) + `apps/web/next.config.ts` if it needs to reach the browser | — |

---

## 12. What's done vs what's left (snapshot)

### ✅ Foundation done
- All UI scaffolded (7 client + 16 admin + marketing pages)
- Auth: email/password + Google OAuth + admin allowlist + JWT route protection (proxy + server guards)
- RLS policies for Layer 1 INSERT/UPDATE (migrations 0007 + 0008)
- Onboarding form with auto-slug + RLS-correct insert
- Settings: profile, password, notifications, deletion request
- Admin QA approve/reject
- 49 tests (slug, proxy routing, admin allowlist, RLS, live Supabase)
- DB swap workflow (`pnpm db:swap`)
- Env loading (workspace-root → app via `@next/env` + sync script)

### ⏳ Phase 1 remaining (split per §7)
- **Lead:** AI providers, Memory Controller, 11 n8n flows, Qdrant
- **Dev 2:** Stripe, Resend templates, Copilot chat UIs, realtime processing screen, PostHog, page-data wiring, password reset flow
- **Dev 3:** Weavy chain, Sharp overlay, scrapers, load test, sample storage assets

If each dev sticks to their lane and respects the contracts in §7.5, all three can ship M1 → M3 in parallel without blocking each other.

---

**Last updated:** 2026-04-27
**Owners:** Usama (Lead), Dev 2 (Frontend), Dev 3 (Backend/Visual)
**Review cadence:** every Monday, M1 / M2 / M3 milestone gates per master plan.
