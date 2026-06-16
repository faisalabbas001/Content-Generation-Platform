-- 0017 — Remove the realtime_read policies introduced in 0016.
--
-- They duplicated coverage already provided by the existing client_isolation
-- policies on Layer 1 tables, AND when the dev environment uses the anon JWT
-- in the service-role slot (HANDOVER known issue), auth.uid() returns null
-- and the realtime websocket gets CHANNEL_ERROR because RLS rejects every
-- broadcast row.
--
-- The replica identity FULL changes from 0016 STAY — those are required.

begin;

drop policy if exists realtime_read on public.brand_snapshots;
drop policy if exists realtime_read on public.brand_profiles;

commit;
