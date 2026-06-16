# 3-Month Rolling Calendar — Architecture & Implementation Plan

**Author:** Lead Solutions Architect
**Status:** Design — ready to build
**Aligns with:** OGZ_COMPLETE_SYSTEM_DOCUMENT §5.1 (lines 353-366), §5.4 (governance), doc.md §5.2 (A01 steps), §11.2 (scaling), §13.1 (feasibility). Phase 1 deliverable.

---

## 0. The single most important design decision

**One `calendars` row already equals one (brand, month).** `calendar_posts` is unique on `(calendar_id, position)` with position 1-20. Therefore **a 3-month calendar = 3 calendar rows**, NOT one calendar with 60 posts.

This is the keystone. It means:

- ✅ **No position-constraint change needed.** Each month keeps positions 1-20 (well within the existing `0..50` check). We do NOT pack 60 posts into one calendar.
- ✅ **Per-month isolation for free.** A Month-3 failure cannot corrupt Month-1/2 — they are separate rows, separate inserts, separate lease keys (`brand_id, month`).
- ✅ **The decoupled worker is month-agnostic.** `claim_pending_visual` / `reap_stale_visual_claims` operate on `calendar_posts.status` regardless of which calendar/month — **zero worker changes**.
- ✅ **Notifications already keyed per-calendar** (`notify_state`, `generated_email_sent`, `approved_email_sent` are columns on `calendars`) — each month notifies independently.

We are **not** introducing a new table or a `month_num` column. We reuse the existing one-row-per-month grain and add (a) a generation **ledger** to drive the rolling trigger, and (b) **batching discipline** to handle 3× volume.

---

## 1. Workflow Refactoring (N8N-A01)

### 1.1 Decision: loop months PER BRAND, inside the existing per-brand iteration — NOT across separate batch runs.

**Why per-brand-internal, not separate runs:**
- A brand's 3 months share the same BrandDNA, CaptionContext (COO), CEO classify, and chain selection. Recomputing those per-month-per-run wastes 3× the expensive LLM calls. Generate CaptionContext **once**, reuse for all 3 months.
- The lease + calendars row is already `(brand_id, month)` — natural per-month unit inside one brand pass.
- Spanning months across batch *runs* would fight the shard model (a brand belongs to ONE shard night) and complicate the rolling trigger.

**But** the heavy lifting (DeepSeek + images) is moved OUT of the n8n event loop (see §1.3) so n8n memory never holds 3,600 posts.

### 1.2 New A01 shape (per brand, inside `Loop Brands (5 Parallel)`)

```
Loop Brands (batchSize 3)                 ← REDUCED from 5 (see §5 concurrency math)
  └─ Prepare Brand Data (ONCE per brand)
  └─ CEO Classify (ONCE)                   ← confidence_mode, occasion_flags
  └─ COO CaptionContext (ONCE)             ← reused for all 3 months
  └─ Compute target months = [M0, M1, M2] ← from Prepare Batch Config (see §1.4)
  └─ Loop Months [M0,M1,M2] (SEQUENTIAL, batchSize 1)
       └─ Build schedule_dates for THIS month
       └─ Insert Calendar Lease (brand_id, THIS month)   ← per-month lease
       └─ Plan Slots (THIS month)
       └─ Call: generate-all (THIS month)   ← app route does the chunking (§1.3)
       └─ Match Chain / CCO / CEO Gate (THIS month)
       └─ Upsert Calendar → calendar_id
       └─ Skeleton Builder → Bulk Insert calendar_posts (status pending_visual)
       └─ Mark ledger row month=generated   ← §2.3
  └─ Trigger V01 Worker (once per brand, after all 3 months inserted)
```

Months run **sequentially within a brand** so n8n holds at most one month's ~20 posts in memory at a time, and a Month-3 DeepSeek timeout cannot abort Months 1-2 (they're already committed — see §4).

### 1.3 The chunking/timeout fix lives in the APP, not n8n (already true — keep it)

`/api/agents/deepseek/generate-all` already does: split `schedule_dates` into `CHUNK_SIZE=3`, run `CONCURRENCY=4` with `MAX_ATTEMPTS=4` per chunk, `maxDuration=300`. **One month = one call to this route = ~20 posts.** This is the proven, parse-safe unit. We do **not** send 60 posts in one call.

**Required change:** none to the chunking algorithm. The schema cap is `post_count.max(120)` — fine, one month is ≤31. We keep one route call PER MONTH (3 calls per brand), never one 60-post call. This keeps each call inside the 300s budget and isolates month failures.

### 1.4 `Prepare Batch Config` — compute the 3-month target window

Replace single `target_month` with a **`target_months[]`** array:

```js
// Initial generation: current month + next 2.  (Rolling append: see §2.4 — appends only M+3.)
const base = new Date(target_year, target_month, 1);
const target_months = [];
const N = (mode === 'ROLLING_APPEND') ? 1 : 3;        // append=1 new month, initial=3
const startOffset = (mode === 'ROLLING_APPEND') ? 3 : 0; // append generates month +3
for (let i = 0; i < N; i++) {
  const d = new Date(base.getFullYear(), base.getMonth() + startOffset + i, 1);
  target_months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
}
```

- **MONTHLY / first-ever brand** → `mode='INITIAL'` → 3 months `[M0, M1, M2]`.
- **Rolling append** (end-of-month cron) → `mode='ROLLING_APPEND'` → just `[M3]` (the new 4th month), because M0-M2 already exist. Idempotent via the lease + ledger.

### 1.5 Scheduling

- **Keep** the nightly shard cron `0 20 * * 0,1,2,3,4` (Sun-Thu 23:00 AST) — but it now runs INITIAL 3-month generation for brands that have `< 3` future months in the ledger (new brands, gaps).
- **Add a rolling cron** (or reuse "1st of Month — Orchestrator") that, for each brand, checks the ledger and generates the missing furthest month so the runway stays at 3. Cadence: daily at an off-peak hour, but it only does work for brands whose runway dropped below 3 (cheap no-op otherwise). Per doc §5.1 "when month 1 completes, month 4 is generated."

---

## 2. Database & Lease Management

### 2.1 Position constraint — NO CHANGE (decision)

We keep `position between 0 and 50` and keep 1-20 per month. Because each month is its own `calendars` row, we never exceed 20 per calendar. **Do not** widen to 0-60. (If on-demand later needs >50 we revisit, but rolling does not.)

> Migration 0044 comment already anticipated this: positions 21-50 were "future capacity… supports 3-month rolling window." We don't even need that range — months are separate rows.

### 2.2 `calendars` table — already sufficient

`(brand_id, month)` unique = the lease. `status`, `notify_state`, `generated_email_sent`, `approved_email_sent` are per-row = per-month. **No change** except optionally a `generation_batch_id` column for audit (nice-to-have, not required).

### 2.3 NEW: generation ledger to drive the rolling trigger autonomously (migration 0107)

We need to answer "which months does brand X already have?" cheaply and idempotently. The `calendars` table already records months, so the ledger is mostly a **view/RPC over `calendars`**, plus one helper:

```sql
-- 0107_rolling_calendar.sql

-- A brand's furthest-generated future month + how many future months it has.
create or replace function public.brand_calendar_runway(p_brand_id uuid)
returns table (months_ahead int, max_month text)
language sql stable security definer set search_path = public as $$
  with future as (
    select month from public.calendars
    where brand_id = p_brand_id
      and month >= to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM')
  )
  select count(*)::int, max(month) from future;
$$;

-- The set of brands whose runway < 3 (need generation), sharded.
create or replace function public.brands_needing_runway(p_target int default 3, p_limit int default 200)
returns table (brand_id uuid, months_ahead int, max_month text)
language sql stable security definer set search_path = public as $$
  select b.brand_id, r.months_ahead, r.max_month
  from public.brand_profiles b
  cross join lateral public.brand_calendar_runway(b.brand_id) r
  where b.onboarding_status = 'extraction_done'        -- only fully-onboarded brands
    and (b.tier <> 'free' or b.total_calendars_generated = 0)
    and coalesce(r.months_ahead, 0) < p_target
  order by coalesce(r.months_ahead, 0) asc
  limit p_limit;
$$;
```

The rolling cron calls `brands_needing_runway(3)` → for each, computes the missing month(s) → runs the per-month generation pipeline. **Autonomous:** as the current month elapses, runway drops to 2, the function returns that brand, the cron appends month +3. No manual bookkeeping.

### 2.4 Lease = idempotency for the rolling append

The per-month `INSERT … on_conflict=brand_id,month` lease means re-running the rolling cron is safe: if month M3 already exists, the upsert is a no-op and the ledger shows runway=3, so it's skipped next time. **Exactly-once per (brand, month)** without distributed locks.

### 2.5 Status lifecycle (unchanged, per governance §5.4)

`calendars`: draft → generating → pending_review → delivered | rejected.
`calendar_posts`: pending_visual → visual_processing → clean/watermark/failed_visual.
**Governance preserved:** every post lands `pending_visual` → worker generates → `requires_human_review`/qa_review_queue → **admin releases → status flips client-visible**. No month, in any of the 3, auto-shows. (See §3 governance.)

---

## 3. Admin UI/UX — handling the qa_review_queue influx

3× posts = the queue and the brand-workspace grid must stay fast and filterable by **month**.

### 3.1 The problem with today's query

`qa_review_queue` has **no month/calendar_id column** — admin grouping is done by joining `calendar_posts`. At 3,600 posts/shard that join + in-app grouping gets heavy, and the admin can't filter "show me only July for Al-Baik."

### 3.2 Fix A — denormalize `month` + `calendar_id` onto `qa_review_queue` (migration 0107)

```sql
alter table public.qa_review_queue
  add column if not exists calendar_id uuid references public.calendars(calendar_id),
  add column if not exists month text;   -- 'YYYY-MM', denormalized for fast filter

create index if not exists qa_review_queue_brand_month_idx
  on public.qa_review_queue (brand_id, month, status);
create index if not exists qa_review_queue_calendar_idx
  on public.qa_review_queue (calendar_id) where calendar_id is not null;
```

The Worker's `Apply V01 Result` node (which already inserts the qa row) sets `calendar_id` + `month` from the post — a one-line addition to the insert body. Backfill existing rows once in the migration.

### 3.3 Fix B — month-grouped admin queries

- `getCalendarMonthQaItems(brandId, month)` already exists and filters by month → it stays the per-month workspace query (now backed by the index, not an in-app join).
- Add `getQaMonthSummary(brandId)` → returns `[{month, total, pending, released, blocked}]` from a single grouped query so the brand workspace shows **month tabs with counts** (e.g. "June 17 · July 20 · Aug 20") and the admin approves one month at a time.
- `getQaCalendarGroups` (the top-level list) groups by brand; add a `months: string[]` per brand so the list shows runway at a glance.

### 3.4 UX: month tabs + per-month "Approve All"

The brand workspace (`/admin/qa/[brandId]`) gets **month tabs**. "Approve All" becomes **"Approve All — {month}"** (releases one calendar/month at a time), which maps cleanly to the per-calendar `approved_email_sent` idempotency and one `calendar_approved` email per month. This keeps each admin action bounded to ~20 posts, never 60.

### 3.5 Pagination guardrail

`getQaQueuePaged` already paginates. Enforce a default page size (e.g. 50) and never render an unbounded grid; the month tabs naturally cap a view to one month's ~20 posts.

---

## 4. Resilience — a Month-3 failure must not wipe Months 1-2

This is structurally guaranteed by the per-month grain, reinforced by sequencing:

### 4.1 Commit each month before starting the next

Months loop **sequentially** and each month's `Bulk Insert calendar_posts` is its own committed transaction. By the time Month 3 runs, Months 1-2 rows are already persisted (`pending_visual`) and the Worker may already be generating their images. A Month-3 failure leaves M1/M2 fully intact.

### 4.2 Per-month error branch → S03 + continue, never abort the brand

Wrap each month iteration so a failure (DeepSeek total-fail, plan-slots 500, bulk-insert 4xx) routes to the existing S03 anomaly alert with `{brand_id, month, stage}`, logs `usage_logs` failure, **records nothing in the ledger for that month**, and the Months loop **continues** to the next month / the brand loop continues to the next brand. The rolling cron will retry the missing month on its next pass (idempotent via lease).

### 4.3 Chunk-level resilience (already present, keep)

`generate-all` retries each 3-post chunk up to 4× and keeps the fullest partial. A single bad chunk degrades that month to e.g. 17/20 posts (still useful, admin sees them) rather than failing the month. The "retry-until-full" loop is per-chunk, isolated per month.

### 4.4 Worker resilience (already present, keep)

`reap_stale_visual_claims(5 min)` + `claim_pending_visual` `FOR UPDATE SKIP LOCKED` + the fal.ai **resubmit + model-ladder** (proven: 17/17) handle visual-gen flakiness independent of months. Stuck posts in any month self-recover within 5 min.

### 4.5 Idempotent re-run

Re-running A01 for a brand: lease upsert makes existing months no-ops; `on_conflict=calendar_id,position` makes post inserts merge-not-duplicate. Safe to retry the whole brand or just a month.

---

## 5. Scale math + concurrency tuning (the 300% payload)

**Volume:** 60 brands × 3 months × 20 posts = **3,600 posts/shard** (text) → 3,600 images via the Worker.

### 5.1 n8n memory — never holds 3,600 posts

Because months are sequential and each month's posts are inserted then dropped from the working set, n8n holds **≤ batchSize × 1 month ≈ 3 brands × 20 = 60 posts** at peak. The 3,600 figure lives in Supabase + the Worker queue, never in an n8n array.

### 5.2 DeepSeek timeout/rate — bounded by design

- 1 month = 1 `generate-all` call = up to ~7 internal DeepSeek calls (chunks×attempts), `CONCURRENCY=4`.
- A01 brand batch = 3 (recommended, down from 5). 3 brands × (sequential months) → at most 3 concurrent `generate-all` calls × 4 internal = **≤12 concurrent DeepSeek requests**. Tune via `CONCURRENCY` and `Loop Brands batchSize` to stay under DeepSeek TPM (per memory: OpenAI Tier-1 ~30k TPM; prompt-composer/COO on DeepSeek).
- **Lower `Loop Brands` batchSize 5 → 3** to keep concurrent LLM pressure flat despite 3× the months. (3 brands × 1 month-at-a-time ≈ same instantaneous load as old 5 brands × 1 month, but now multiplied over time, not concurrency.)

### 5.3 fal.ai / Worker throughput — the real bottleneck, throttled correctly

- 3,600 images at ~25s each, Worker `BATCH=5`/tick, 1-min cron = ~5 images/min/worker = **far too slow** (3,600 ÷ 5/min = 12 hours). This is acceptable *only* because generation is decoupled and admin review happens over days (doc §5.4: content produced 7 days ahead), **but** we should raise throughput:
  - Raise Worker `BATCH` from 5 → **10** and/or run the Worker tick every 30s, watching fal.ai 429s. The model-ladder already handles transient rejects.
  - The reaper (5 min) ensures any tick that over-claims and stalls self-heals.
  - **Cost guard (doc §10.3, §6.1):** before each month's generation, CEO cost-ceiling check (`monthly_ceiling_usd`, 70/90/100% alerts). At 100% → halt that brand's further months, S03 alert. 3× volume makes this guard mandatory, not optional.
- **Spread the load:** initial 3-month backfill for the whole base should be **staggered across the shard nights** (each brand's shard night does its own 3 months), not all 60 brands on one night. The existing shard model already does this — we just keep it.

### 5.4 Supabase

- Bulk insert is per-month (~20 rows) — trivial. 3,600 rows/shard across many small inserts is well within limits.
- New indexes (§3.2) keep admin queries O(index) not O(scan).
- `brands_needing_runway` is a cheap lateral over `calendars` (indexed by brand_id, month).

---

## 6. Step-by-step build order

**Migration (0107_rolling_calendar.sql):**
1. `brand_calendar_runway(brand_id)` + `brands_needing_runway(target, limit)` RPCs (§2.3).
2. `qa_review_queue.calendar_id` + `.month` columns + 2 indexes + backfill (§3.2).
3. (optional) `calendars.generation_batch_id` for audit.

**App (`packages/db`):**
4. `getQaMonthSummary(brandId)` query + extend `getQaCalendarGroups` with `months[]` (§3.3).

**App (`apps/web`):**
5. Brand-workspace month tabs + "Approve All — {month}" (§3.4). Each tab → `getCalendarMonthQaItems(brandId, month)`.

**n8n N8N-A01:**
6. `Prepare Batch Config`: emit `target_months[]` + `mode` (INITIAL=3 | ROLLING_APPEND=1) (§1.4).
7. Move CEO Classify + COO CaptionContext to run ONCE per brand (before the months loop) (§1.2).
8. Add inner **Loop Months (batchSize 1, sequential)** wrapping: schedule-build → lease → plan-slots → generate-all → match/cco/gate → upsert calendar → skeleton → bulk insert (§1.2).
9. Worker `Apply V01 Result`: add `calendar_id` + `month` to the qa_review_queue insert (§3.2).
10. Per-month error branch → S03 + continue (§4.2).
11. Lower `Loop Brands` batchSize 5 → 3 (§5.2).

**n8n N8N-V01-Worker:**
12. Raise `BATCH` 5 → 10 (and/or 30s tick), monitor fal.ai 429 (§5.3).

**Rolling trigger:**
13. New cron (daily off-peak) → call `brands_needing_runway(3)` → for each brand+missing month, POST the A01 webhook with `{brand_id, mode:'ROLLING_APPEND', target_month}` (§1.5, §2.4).

**Verify:**
14. One brand, mid-month: confirm 3 calendars created, 60 posts pending_visual, worker drains them, all 60 land in qa_review_queue with month set, admin sees 3 month tabs, releasing July emails once. Then advance the clock / delete the furthest month and confirm the rolling cron re-appends it idempotently.

---

## 7. What we deliberately do NOT change (and why)

| Tempting change | Why we DON'T |
|---|---|
| Widen `position` to 0-60 | Months are separate calendar rows; 1-20 each. No need. |
| New `calendar_posts.month_num` column | `calendar_id`→`calendars.month` already encodes it. |
| One 60-post `generate-all` call | Breaks the 300s budget + parse-safety + month isolation. Keep 1 call/month. |
| New worker queue table | `claim_pending_visual` is already month-agnostic and proven. |
| Parallel months per brand | Wastes shared LLM work + risks concurrent DeepSeek pressure; sequential gives free resilience. |

---

## 8. Governance restatement (non-negotiable, per doc §5.4)

All 3 months → every post `pending_visual` → image generated → `requires_human_review` + `qa_review_queue` → **admin explicitly releases per month** → only then client-visible on `/[slug]/calendar`. The blurred "coming soon" teaser covers the gap. **No month, in any state, auto-delivers to the client.**
