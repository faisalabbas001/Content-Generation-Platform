-- Migration 0105: Teach the worker RPCs about async-video states.
--
-- Images are synchronous: the worker writes clean/watermark/held immediately.
-- Videos are ASYNC: the worker submits to fal.ai (/api/image/generate-video) and a
-- separate webhook (/api/webhooks/fal-ai/video-callback) finishes them LATER, setting
-- status='generated' (success) or status='draft'/failed (failure).
--
-- The worker parks a submitted video at status='video_processing' so it is NOT
-- re-claimed and the Completion Sweep keeps waiting. This migration updates the two
-- RPCs so they understand the video lifecycle:
--   • claim_pending_visual: unchanged trigger (only claims pending_visual) — but we
--     also let the reaper rescue stuck 'video_processing' rows.
--   • calendars_ready_for_email: a calendar is ready only when nothing is still
--     rendering (pending_visual / visual_processing / video_processing), and
--     'generated' (completed video) now counts as APPROVED.
--   • reap_stale_visual_claims: also reclaims 'video_processing' older than the
--     window (fal callback never arrived) back to pending_visual for a retry.
--
-- Idempotent: CREATE OR REPLACE only.

-- ── calendars_ready_for_email(): video-aware approved/blocked/waiting buckets ──
create or replace function public.calendars_ready_for_email()
returns table (
  calendar_id    uuid,
  brand_id       uuid,
  total_posts    bigint,
  blocked_posts  bigint,
  approved_posts bigint
)
language sql
stable
set search_path = public
as $$
  select cp.calendar_id,
         cp.brand_id,
         count(*)                                                                   as total_posts,
         count(*) filter (where cp.status in ('hard_blocked','failed_visual'))      as blocked_posts,
         -- 'generated' = completed async video; counts as approved alongside images.
         count(*) filter (where cp.status in ('clean','watermark','held','generated')) as approved_posts
    from public.calendar_posts cp
    join public.calendars c on c.calendar_id = cp.calendar_id
   where c.notify_state = 'none'
   group by cp.calendar_id, cp.brand_id
  having count(*) filter (
           -- still rendering: images claimed OR videos queued at fal.
           where cp.status in ('pending_visual', 'visual_processing', 'video_processing')
         ) = 0;
$$;

comment on function public.calendars_ready_for_email() is
  'Calendars with notify_state=none and nothing still rendering '
  '(pending_visual / visual_processing / video_processing). approved = '
  'clean/watermark/held/generated; blocked = hard_blocked/failed_visual.';

-- ── reap_stale_visual_claims(): also rescue stuck async-video submissions ─────
-- A 'video_processing' row whose fal callback never arrived would otherwise wait
-- forever. After p_stale_minutes, flip it back to pending_visual so the worker
-- re-submits. (Image 'visual_processing' rescue behaviour is unchanged.)
create or replace function public.reap_stale_visual_claims(p_stale_minutes int default 15)
returns int
language sql
security definer
set search_path = public
as $$
  with reaped as (
    update public.calendar_posts
       set status = 'pending_visual', claimed_at = null
     where status in ('visual_processing', 'video_processing')
       and claimed_at < now() - make_interval(mins => p_stale_minutes)
    returning 1
  )
  select count(*)::int from reaped;
$$;

comment on function public.reap_stale_visual_claims(int) is
  'Reclaims calendar_posts stuck in visual_processing (dead image worker) OR '
  'video_processing (fal callback never arrived) longer than p_stale_minutes, '
  'flipping them back to pending_visual for retry. Called at the start of each worker tick.';

-- NOTE: videos can legitimately take longer than 15 min to render. The worker should
-- call reap_stale_visual_claims(45) (or higher) so a slow-but-alive fal job is not
-- prematurely re-submitted. The worker's STALE_MINUTES constant controls this.
