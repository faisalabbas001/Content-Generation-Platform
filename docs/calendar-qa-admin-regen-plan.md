# Calendar QA & Admin Regeneration — Implementation Plan

> Status: PLAN (no code written yet). Based on full trace of existing user-side
> regenerate flow, the N8N-B03 workflow, and the DB schema.

## Key discoveries from analysis

1. **B03 already supports admin regeneration.** The workflow `N8N-B03_ Revision
   Request Handler.json` branches on a `target` field. When `target: 'admin'` it:
   - bypasses the revision cap (unlimited admin revisions)
   - bypasses both CEO/confidence human-gates
   - **does NOT touch `calendar_posts`** — it INSERTs a versioned draft row into
     an `admin_regenerations` table (status `'draft'`), returning
     `{ success: true, target: 'admin', version, message }`.

2. **The `admin_regenerations` table was never created.** No migration, not in
   generated types. So admin regens silently fail today → S03 error path. **This
   is the #1 thing to fix.** B03's exact expected columns (from its INSERT node):
   `post_id, request_id, brand_id, version, media_type, storage_url,
   clean_storage_url, caption_ar, hashtags (text[]), confidence_score, watermark,
   prompt_override (text/json), image_model, status ('draft'), created_by`.
   Plus we add: `regen_id pk, created_at` (B03 reads back `regen_id`).

3. **Latent bug in current `requestRevision` (apps/web/src/app/actions/qa.ts):**
   it does `qa_review_queue.update({ status: 'revision_requested' })`, but
   `qa_status_type` enum only allows `('pending','approved','rejected','edited','escalated')`.
   That UPDATE **fails at runtime**. Must fix.

4. **Client visibility gate** (load-bearing): `packages/db/src/queries/calendars.ts`
   filters `.in('status', ['pending','approved'])`. Anything else is hidden from
   clients. Admin drafts live in a separate table, so they're invisible by
   construction — approved version is never overwritten until admin promotes.

5. **On-demand regenerate modal** (`[slug]/on-demand/regenerate-button.tsx`) is the
   UX to mirror: two-step (`choose` → `editing`), cards "Use Existing Prompt" /
   "Edit & Regenerate", fields style_descriptor / hero_concept / negative_prompt /
   cultural_guidance, max-length validation, polls for completion.

6. **B03 payload keys** (admin path must send): `brand_id, post_id, revision_reason
   (≥5 chars), revision_type, target: 'admin', image_model, created_by,
   prompt_override?`. Calendar/QA callers use the HMAC helper `triggerN8nB03Revision`.

---

## Issue 1 — Year + Month filter

**File:** `apps/web/src/app/admin/qa/[brandId]/page.tsx`

- Derive available years from the brand's calendars. Current `getQaCalendarGroups`
  returns one active calendar per brand; extend the brand-detail data load to fetch
  **all** calendars for the brand (`calendarsQ` / new admin query) so we know which
  (year, month) pairs actually have content.
- Render a **Year `<select>`** + the existing 12 month pills. Selecting a year filters
  which months are interactive; selecting a month loads that calendar's posts.
- URL state: `?year=2026&month=2026-05`. Default to the most recent calendar.
- New DB query `adminQ.getBrandCalendarsForQa(brandId)` → `[{ calendar_id, month,
  status, pending_count }]` so month pills show per-month pending badges across years.

## Issue 2 — Pending post cards in the selected month

**File:** `apps/web/src/app/admin/qa/[brandId]/brand-calendar-workspace.tsx`

- The 20-slot grid already exists. Ensure pending posts render their **thumbnail,
  scheduled date, status dot, brand association** directly (already mostly done).
- Add a dedicated "Pending in this month (N)" strip above/below the grid listing the
  pending cards with quick Approve/Reject, so admins see them without hunting.

## Issue 3 — Rich post detail modal

**File:** `brand-calendar-workspace.tsx` (PostInspectionModal — already scaffolded)

Confirm it renders, in tabs:
- **Basic:** image, image_prompt_en, scheduled date, brand, status, created/updated time.
- **DeepSeek data:** caption_ar, caption_variants (+ selected index), hashtags,
  content_type, strategic_rationale, occasion_flags, route_decision, chain_id,
  visual_brief_en, platform/channel, watermark, model, c2pa.
- **CCO/flags:** cco_score, confidence_score, hold reasons w/ explanations, raw flags.
- **History:** revision_history JSONB entries.

(Most of this exists from the prior round; verify field wiring against the now-richer
`CalendarQaPostRow` and fix any gaps.)

## Issue 4 — Approve (real-time, no refresh)

- Reuse existing `approveQaItem(queueId)` server action (already updates
  `qa_review_queue` → approved, `calendar_posts` downstream, fires N8N-QA-Approved).
- Verify the **client calendar** flips to visible: approval path must leave the post
  at `status IN ('pending','approved')`. Confirm `bulkApproveCalendar`/`approveQaItem`
  set `calendar_posts.status='approved'` (bulk does; per-item path may need it too).
- UI: optimistic update + `router.refresh()`; modal shows success banner, closes.

## Issue 5 — Reject (hide from client, preserve history)

- Reuse `rejectQaItem(queueId)` (sets queue→rejected). **Add:** also set the linked
  `calendar_posts.status='rejected'` so it leaves the client's `('pending','approved')`
  set and disappears from their calendar. QA history preserved (queue row kept).
- **Fix the latent enum bug** in `requestRevision` first (don't write
  `revision_requested` to the queue — use a valid value or only mutate calendar_posts).

## Issue 6 — Admin Regenerate with compare (the core new feature)

### 6a. Migration — create `admin_regenerations`
**New file:** `supabase/migrations/0101_admin_regenerations.sql`
Columns exactly matching B03's INSERT (see discovery #2) + `regen_id uuid pk default
gen_random_uuid()`, `created_at timestamptz default now()`,
`status text default 'draft'` (values: draft | promoted | discarded),
FK `post_id → calendar_posts`, index on `(post_id, version)`. RLS: service-role only
(admin-only, never client-readable).

### 6b. DB types + query
- Regenerate generated types (or hand-add to `database.types.ts`) for the new table.
- New `adminQ.getAdminRegenerations(postId)` → versions list for the compare view.

### 6c. Admin regenerate server action
**File:** `apps/web/src/app/actions/qa.ts` — new `requestAdminRegenerate(postId,
brandId, { revisionReason, promptOverride?, imageModel })`:
- `requireAdmin()`, audit to `usage_logs`.
- Fire `triggerN8nB03Revision({ post_id, brand_id, revision_reason, revision_type:
  'full', target: 'admin', image_model, created_by: admin.email, prompt_override? })`.
- Do **not** mutate `calendar_posts` (B03 writes the draft).

### 6d. Admin regenerate modal (mirror on-demand UX)
**New file:** `apps/web/src/app/admin/qa/[brandId]/regenerate-modal.tsx`
- Copy the two-step card UX + Model dropdown (`auto | nano_banana | flux_ultra`) from
  `regenerate-button.tsx`, adapted to admin action + calendar post fields.
- Header: "Regenerate image — Admin draft, hidden from client until approved"
  (matches the screenshot).

### 6e. Compare view (original vs regenerated)
**In** `PostInspectionModal`: add a "Regenerations (N)" tab. Side-by-side:
- **Original:** calendar_posts image / prompt / caption / hashtags.
- **Regenerated draft(s):** each admin_regenerations row's image / prompt_override /
  caption / hashtags, newest first. Poll/refresh after a regenerate fires.

### 6f. Promote draft → live (approve regenerated)
**File:** `apps/web/src/app/actions/qa.ts` — new `promoteAdminRegeneration(regenId)`:
- `requireAdmin()`. Read the draft row.
- **Append current live version into `calendar_posts.revision_history`** (audit).
- Copy draft `storage_url, clean_storage_url, caption_ar, hashtags,
  confidence_score, watermark` onto `calendar_posts`; set `status='approved'`,
  bump `updated_at`.
- Mark draft row `status='promoted'`; optionally mark sibling drafts `discarded`.
- `revalidatePath` admin + `/${slug}/calendar` → client sees new content immediately.
- Discard action: `discardAdminRegeneration(regenId)` → status `discarded`.

---

## Data-integrity guarantees

- Approved client content is **never overwritten** until `promoteAdminRegeneration`.
- Admin drafts isolated in `admin_regenerations` (separate table, RLS service-only).
- `revision_history` JSONB preserves the prior live version on every promote.
- No CHECK constraint on `calendar_posts.status` — safe to set 'rejected'/'approved'.
- Reuses existing approve/reject/B03 plumbing; no breaking changes to client query.

## Build order (with checkpoints)

1. **Fix latent bug** (requestRevision enum) + migration `0101_admin_regenerations`. ⬅ checkpoint
2. Issue 5 reject→calendar_posts; Issue 4 verify approve flips client. ⬅ checkpoint
3. Issue 1 year+month filter (+ new brand-calendars query).
4. Issues 2 & 3 pending cards + rich modal verification. ⬅ checkpoint
5. Issue 6 admin regenerate action + modal + compare tab + promote/discard. ⬅ checkpoint
6. Typecheck (`tsc --noEmit`) clean on all touched files each checkpoint.
