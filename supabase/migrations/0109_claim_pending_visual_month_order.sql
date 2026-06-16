-- 0109 — claim_pending_visual: claim in MONTH-SEQUENTIAL order (not random).
--
-- Problem: A01 builds June/July/August in ONE run, so calendar_posts.created_at is
-- nearly identical across all three months. The old RPC ordered by created_at, so the
-- worker claimed posts in an effectively RANDOM mix of months → the admin UI filled
-- June/July/Aug visuals interleaved instead of "finish June, then July, then August".
--
-- Fix: order by posting_time (June < July < Aug, then by date/position within a month),
-- with created_at as a stable tiebreaker. Combined with the worker's BATCH=10 chunking,
-- each cron tick claims the EARLIEST unfinished month's next 10 posts → the UI fills
-- one month fully before the next begins, and nothing is processed out of order.
-- posting_time NULLS LAST so any post missing a schedule still gets picked up eventually.
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
      order by posting_time asc nulls last, created_at asc, position asc
      limit p_limit
      for update skip locked
   )
  returning cp.*;
$$;

comment on function public.claim_pending_visual(int) is
  'Atomically claims up to p_limit pending_visual posts (FOR UPDATE SKIP LOCKED), '
  'flips them to visual_processing, ordered by posting_time (MONTH-SEQUENTIAL) so the '
  'worker finishes one month before the next. Called by N8N-V01-Worker each cron tick.';
