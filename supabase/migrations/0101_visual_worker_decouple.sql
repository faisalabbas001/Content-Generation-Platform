-- Migration 0101: Decouple visual generation from N8N-A01 (producer/worker split)
--
-- N8N-A01 (producer) now writes post skeletons with status='pending_visual' and
-- ends — no synchronous visual loop. A separate cron-driven worker (N8N-V01-Worker)
-- claims pending posts, generates the image via /api/image/generate (fal.ai → Sharp
-- Arabic overlay → Supabase Storage), then updates the row and pushes flagged posts
-- to qa_review_queue.
--
-- This migration:
--   1. Adds worker lifecycle + Admin-UI columns to calendar_posts.
--   2. Denormalizes storage_url + hold_reason onto qa_review_queue for the
--      Admin single-query join (FK post_id already exists — migration 0078).
--   3. Adds an atomic claim function so overlapping worker ticks never grab the
--      same row (FOR UPDATE SKIP LOCKED).
--
-- Idempotent: every statement guards with IF (NOT) EXISTS.

-- ── 1. calendar_posts: worker lifecycle + Admin UI fields ────────────────────
-- Note: storage_url (image), watermark, confidence_score, status already exist
-- (0001_init). image_prompt_en already exists (0100) — reused for the English brief.
alter table public.calendar_posts
  add column if not exists chain_id        text,
  add column if not exists route_decision  text,   -- clean | watermark | hold
  add column if not exists hold_reason     text,    -- trigger_reason mirror for Admin UI
  add column if not exists cco_score       float,
  add column if not exists visual_failed   boolean not null default false,
  add column if not exists claimed_at      timestamptz;

comment on column public.calendar_posts.status is
  'draft | pending_visual | visual_processing | clean | watermark | held | failed_visual | hard_blocked';
comment on column public.calendar_posts.hold_reason is
  'Why this post was held/flagged — mirrored into qa_review_queue.trigger_reason for the Admin UI.';

-- Fast worker claim: partial index over only the unrendered queue.
create index if not exists idx_calendar_posts_pending_visual
  on public.calendar_posts (created_at)
  where status = 'pending_visual';

-- Completion-sweep lookup: per-calendar status counts.
create index if not exists idx_calendar_posts_calendar_status
  on public.calendar_posts (calendar_id, status);

-- ── 2. qa_review_queue: denormalized image for one-query Admin render ─────────
alter table public.qa_review_queue
  add column if not exists storage_url text,
  add column if not exists hold_reason text;

-- Hard Rule #4 also applies to the denormalized copy (mirror of calendar_posts CHECK).
alter table public.qa_review_queue
  drop constraint if exists qa_no_weavy_urls;
alter table public.qa_review_queue
  add constraint qa_no_weavy_urls
  check (storage_url is null or storage_url not like '%weavy.ai%');

create index if not exists idx_qa_review_queue_status_created
  on public.qa_review_queue (status, created_at desc);

-- ── 3. Atomic claim function (used by N8N-V01-Worker "Claim Batch") ───────────
-- SELECT ... FOR UPDATE SKIP LOCKED guarantees no two worker ticks claim the same
-- row, even with overlapping cron fires at 300-brand scale. SECURITY DEFINER so the
-- worker's anon/service call executes with the function owner's rights.
create or replace function public.claim_pending_visual(p_limit int default 20)
returns setof public.calendar_posts
language sql
security definer
set search_path = public
as $$
  update public.calendar_posts cp
     set status = 'visual_processing', claimed_at = now()
   where cp.post_id in (
     select post_id from public.calendar_posts
      where status = 'pending_visual'
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning cp.*;
$$;

comment on function public.claim_pending_visual(int) is
  'Atomically claims up to p_limit pending_visual posts (FOR UPDATE SKIP LOCKED) and '
  'flips them to visual_processing. Called by N8N-V01-Worker each cron tick.';

-- ── 4. Completion-sweep helper: calendars whose visuals are fully resolved ───
-- Returns calendars where every post has reached a terminal visual state (no
-- pending_visual / visual_processing left) AND the "pending review" email has not
-- yet been sent. Dedup uses the EXISTING calendars.generated_email_sent flag
-- (migration 0098) — NOT a new column. The worker's Completion Sweep calls
-- /api/calendar/notify {type:'generated'} for each, which atomically flips the
-- flag, so even if this returns a row twice the email sends exactly once.
create or replace function public.calendars_ready_for_email()
returns table (calendar_id uuid, brand_id uuid, total_posts bigint, failed_posts bigint)
language sql
stable
set search_path = public
as $$
  select cp.calendar_id,
         cp.brand_id,
         count(*)                                            as total_posts,
         count(*) filter (where cp.status = 'failed_visual') as failed_posts
    from public.calendar_posts cp
    join public.calendars c on c.calendar_id = cp.calendar_id
   where c.generated_email_sent = false           -- reuse 0098 flag, no new column
   group by cp.calendar_id, cp.brand_id
  having count(*) filter (
           where cp.status in ('pending_visual', 'visual_processing')
         ) = 0;
$$;

comment on function public.calendars_ready_for_email() is
  'Calendars where no post is still pending/processing visuals and the pending-review '
  'email has not been sent (calendars.generated_email_sent = false). The worker calls '
  '/api/calendar/notify per row, which flips the flag atomically (dedup-safe).';

-- ── 5. Stuck-state reaper: reclaim orphaned visual_processing rows ────────────
-- If a worker dies between claim_pending_visual (flips to visual_processing) and
-- the PATCH that moves the row to a terminal state, the row would otherwise stay
-- visual_processing forever — and calendars_ready_for_email() would exclude that
-- calendar permanently, so the client never gets the pending-review email.
-- The Worker calls this at the very start of every tick (before Claim Batch) to
-- flip any row stuck >p_stale_minutes back to pending_visual so it is re-claimed.
-- 15 min comfortably exceeds the worst-case single-image generate time (≤600s)
-- plus retries, so it never reaps a row that is genuinely still being rendered.
create or replace function public.reap_stale_visual_claims(p_stale_minutes int default 15)
returns int
language sql
security definer
set search_path = public
as $$
  with reaped as (
    update public.calendar_posts
       set status = 'pending_visual', claimed_at = null
     where status = 'visual_processing'
       and claimed_at < now() - make_interval(mins => p_stale_minutes)
    returning 1
  )
  select count(*)::int from reaped;
$$;

comment on function public.reap_stale_visual_claims(int) is
  'Reclaims calendar_posts stuck in visual_processing longer than p_stale_minutes '
  '(dead worker / failed PATCH) by flipping them back to pending_visual. Called by '
  'N8N-V01-Worker at the start of each tick, before claim_pending_visual.';
