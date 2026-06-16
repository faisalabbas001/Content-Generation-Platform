-- 0107_calendar_count_increment.sql
-- Make brand_profiles.total_calendars_generated a TRUE per-calendar counter
-- (1,2,3,4...) per doc.md:418 (INT) instead of the old 0→1 boolean shortcut.
--
-- A calendar must count EXACTLY ONCE — even if the admin clicks "Approve All"
-- twice or a release surface runs again. We anchor idempotency on a new
-- `calendars.counted_in_total` flag (mirrors the existing approved_email_sent
-- pattern) and do the increment in one atomic RPC so concurrent releases can't
-- double-count.

-- ── 1. Per-calendar "already counted" flag ──────────────────────────────────
alter table public.calendars
  add column if not exists counted_in_total boolean not null default false;

-- ── 2. Atomic, idempotent increment ─────────────────────────────────────────
-- Flips the calendar's flag (compare-and-set) and, only if THIS call won the
-- flip, bumps the brand's counter by 1. Returns the new total (or the current
-- total if it was already counted). security definer: callable by the app's
-- service role; the write stays server-side (doc Hard Rule #2 — no client writes).
create or replace function public.increment_calendar_count(p_calendar_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_id uuid;
  v_won      boolean := false;
  v_total    int;
begin
  -- Compare-and-set the flag; RETURNING tells us if we actually flipped it.
  update public.calendars
     set counted_in_total = true
   where calendar_id = p_calendar_id
     and counted_in_total = false
  returning brand_id into v_brand_id;

  v_won := v_brand_id is not null;

  if v_won then
    update public.brand_profiles
       set total_calendars_generated = total_calendars_generated + 1,
           updated_at = now()
     where brand_id = v_brand_id
    returning total_calendars_generated into v_total;
    return coalesce(v_total, 0);
  end if;

  -- Already counted (or calendar missing) → return the current total, no-op.
  select bp.total_calendars_generated
    into v_total
    from public.calendars c
    join public.brand_profiles bp on bp.brand_id = c.brand_id
   where c.calendar_id = p_calendar_id;
  return coalesce(v_total, 0);
end;
$$;

comment on function public.increment_calendar_count(uuid) is
  'Idempotently +1 brand_profiles.total_calendars_generated the first time a '
  'calendar is released. Anchored on calendars.counted_in_total so a calendar '
  'counts exactly once. Returns the brand''s new total.';

-- ── 3. Backfill: existing delivered/approved calendars should already be counted
-- so we never double-count them on a future release. Mark them counted; the
-- counter itself is left as-is (historical brands keep their current value).
update public.calendars
   set counted_in_total = true
 where status in ('delivered', 'approved')
   and counted_in_total = false;
