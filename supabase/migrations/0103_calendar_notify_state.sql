-- Migration 0103: Per-calendar notification state machine (Case C support)
--
-- The N8N-V01-Worker Completion Sweep now sends TWO distinct notifications:
--   • Approved calendars (>=1 clean/watermark/held post)  → CLIENT "ready for review" email
--   • All-blocked calendars (every post hard_blocked)      → ADMIN alert webhook, NO client email
--
-- Migration 0098's generated_email_sent flag only dedups the client email. It cannot
-- distinguish "client emailed" from "admin alerted", so an all-blocked calendar would
-- either (a) email the client an empty calendar, or (b) re-alert the admin every tick.
--
-- This migration adds a single explicit state column so each terminal notification
-- fires EXACTLY ONCE per calendar. The worker reads/writes it atomically.
--
-- Idempotent: guarded with IF NOT EXISTS / DROP-then-ADD on the constraint.

-- ── notify_state: the notification lifecycle for a fully-resolved calendar ────
--   'none'           → not yet notified (default; visuals may still be in flight)
--   'client_emailed' → approved calendar; client "ready for review" email sent
--   'admin_alerted'  → all posts hard_blocked; admin webhook fired, client NOT emailed
alter table public.calendars
  add column if not exists notify_state text not null default 'none';

alter table public.calendars
  drop constraint if exists calendars_notify_state_chk;
alter table public.calendars
  add constraint calendars_notify_state_chk
  check (notify_state in ('none', 'client_emailed', 'admin_alerted'));

comment on column public.calendars.notify_state is
  'Completion-notification lifecycle: none → client_emailed (approved) | admin_alerted '
  '(all posts hard_blocked). Set once by N8N-V01-Worker Completion Sweep; guarantees '
  'exactly-one notification per calendar per terminal state.';

-- Backfill: calendars already emailed under the old 0098 flag are 'client_emailed'.
update public.calendars
   set notify_state = 'client_emailed'
 where generated_email_sent = true
   and notify_state = 'none';

-- ── calendars_ready_for_email(): now returns the approval breakdown ───────────
-- Replaces the 0101 version. Returns every calendar whose visuals are fully
-- resolved (no pending_visual / visual_processing left) AND notify_state='none',
-- with counts the worker uses to branch Case C (all-blocked) vs approved.
--   total_posts   — all posts on the calendar
--   blocked_posts — posts in hard_blocked / failed_visual (non-deliverable)
--   approved_posts— posts in clean / watermark / held (deliverable to review)
-- Return signature changed vs 0101 (added blocked_posts/approved_posts), so the
-- old function must be dropped before recreating — CREATE OR REPLACE cannot alter
-- a function's OUT columns.
drop function if exists public.calendars_ready_for_email();

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
         count(*)                                                          as total_posts,
         count(*) filter (where cp.status in ('hard_blocked','failed_visual')) as blocked_posts,
         count(*) filter (where cp.status in ('clean','watermark','held'))     as approved_posts
    from public.calendar_posts cp
    join public.calendars c on c.calendar_id = cp.calendar_id
   where c.notify_state = 'none'                 -- not yet notified in either direction
   group by cp.calendar_id, cp.brand_id
  having count(*) filter (
           where cp.status in ('pending_visual', 'visual_processing')
         ) = 0;                                  -- all visuals resolved
$$;

comment on function public.calendars_ready_for_email() is
  'Calendars with all visuals resolved and notify_state=none, plus approved/blocked '
  'counts. Worker branches: approved_posts=0 → admin alert (notify_state=admin_alerted); '
  'approved_posts>0 → client email (notify_state=client_emailed).';
