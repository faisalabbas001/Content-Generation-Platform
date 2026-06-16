-- 0015 — Enable Supabase Realtime for the tables the /processing page subscribes to.
--
-- Without these, the Supabase JS client's `postgres_changes` channel never
-- fires — INSERTs land in the DB but no broadcast happens. Doc §8.3 requires
-- realtime delivery of brand_snapshots updates so the user's processing screen
-- transitions stages without polling.
--
-- We add brand_profiles too because the dashboard's onboarding banner watches
-- `onboarding_status` flips, and admin tooling needs live edits to propagate.
--
-- REPLICA IDENTITY default is sufficient for INSERT-only realtime payloads
-- (which is what we use). UPDATE payloads on these tables only need the PK
-- in `old`, which DEFAULT provides.

begin;

-- supabase_realtime is the publication Supabase uses by default. We add tables
-- only if they aren't already in it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'brand_snapshots'
  ) then
    execute 'alter publication supabase_realtime add table public.brand_snapshots';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'brand_profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.brand_profiles';
  end if;
end $$;

commit;
