-- Calendar lifecycle status state machine (client calendar UX, Doc §8.4).
--
-- Extends calendars.status from {draft, delivered} to the full lifecycle so the
-- client /calendar page can render distinct, accurate states:
--   draft          → row created, generation not started
--   generating     → n8n is actively generating (set via /api/webhooks/n8n
--                    'generation_started' event — best-effort; the UI also infers
--                    this for a fresh draft calendar with no client-visible posts)
--   pending_review → generation finished; posts await OGZ admin release
--   delivered      → admin released posts to the client (terminal "ready" state)
--   rejected       → admin put the calendar on hold; client sees rejection_reason
--
-- Backward compatible: existing rows only hold 'draft'/'delivered', both allowed.

begin;

-- Replace any prior status check (0001 used a bare text column, no constraint).
alter table public.calendars
  drop constraint if exists calendars_status_check;

alter table public.calendars
  add constraint calendars_status_check
  check (status in ('draft', 'generating', 'pending_review', 'delivered', 'rejected'));

-- Review / rejection audit columns.
alter table public.calendars
  add column if not exists reviewed_at      timestamptz,
  add column if not exists reviewed_by      text,
  add column if not exists rejection_reason text;

comment on column public.calendars.reviewed_at is
  'When an admin released (delivered) or rejected this calendar.';
comment on column public.calendars.reviewed_by is
  'Admin auth user id (uuid as text) that released or rejected this calendar. '
  'Admin auth is a separate Supabase instance, so this is stored as opaque text with no FK and no PII.';
comment on column public.calendars.rejection_reason is
  'Client-facing reason shown on the /calendar page when status = rejected.';

-- Ensure Realtime is publishing calendars + calendar_posts so the client
-- /calendar page live-refreshes on release / image completion. Fully best-effort:
-- guarded for environments without the supabase_realtime publication, idempotent
-- when the tables are already members, and tolerant of insufficient privilege so
-- it can never block the migration (realtime config can also be set in the
-- Supabase dashboard).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.calendars;
    exception when others then raise notice 'skip add calendars to supabase_realtime: %', sqlerrm;
    end;
    begin
      alter publication supabase_realtime add table public.calendar_posts;
    exception when others then raise notice 'skip add calendar_posts to supabase_realtime: %', sqlerrm;
    end;
  end if;
end $$;

commit;
