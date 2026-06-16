-- Migration 0090 — Start calibration period at onboarding completion, not calendar
--
-- Problem: migration 0078 created a trigger on the `calendars` table that starts
-- the 90-day calibration window when the first calendar is generated. But the
-- Calendar Engine (Phase 2) is not yet built, so no calendars table rows are ever
-- inserted during onboarding. Result: calibration_started_at stays NULL forever
-- and is_calibration_period stays true (default) but is meaningless.
--
-- Fix: start calibration when brand_profiles.onboarding_status transitions to
-- 'complete'. This is the correct business event — the brand has finished
-- onboarding and their BrandDNA has been written by the Memory Controller.
-- The 90-day clock starts from that moment.
--
-- The calendars-based trigger from 0078 is kept as a no-op safety valve
-- (it checks `calibration_started_at is null` before firing, so it won't
-- re-start calibration if already started here).

begin;

create or replace function public.on_onboarding_complete()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Fire only when transitioning TO 'complete' from any other status
  if new.onboarding_status = 'complete'
     and (old.onboarding_status is null or old.onboarding_status != 'complete')
     and new.calibration_started_at is null
  then
    update public.brand_profiles
       set is_calibration_period  = true,
           calibration_started_at = now(),
           calibration_ends_at    = now() + interval '90 days'
     where brand_id = new.brand_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_onboarding_complete_calibration on public.brand_profiles;

create trigger trg_onboarding_complete_calibration
  after update of onboarding_status on public.brand_profiles
  for each row
  execute function public.on_onboarding_complete();

-- Backfill: any brand already at 'complete' status with no calibration start
-- gets calibration started from their updated_at (best approximation of completion)
update public.brand_profiles
   set is_calibration_period  = true,
       calibration_started_at = updated_at,
       calibration_ends_at    = updated_at + interval '90 days'
 where onboarding_status = 'complete'
   and calibration_started_at is null;

commit;
