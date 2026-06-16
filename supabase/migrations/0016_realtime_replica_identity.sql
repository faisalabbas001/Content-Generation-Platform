-- 0016 — Realtime delivery requirements for brand_snapshots / brand_profiles.
--
-- Two things are needed beyond simply adding the tables to supabase_realtime:
--
--   1. REPLICA IDENTITY FULL on brand_snapshots
--      Realtime needs the full row to (a) check RLS for each subscriber and
--      (b) include the `new` payload in the broadcast. With the default
--      REPLICA IDENTITY (primary key only), filters like `brand_id=eq.<uuid>`
--      can't be evaluated for INSERTs that don't have that column in their
--      replica identity image. The DEFAULT (pkey-only) was enough for the
--      filterless case but Supabase's filter logic and RLS checks need FULL.
--
--   2. SELECT policy that lets the SERVICE_ROLE see snapshot rows (and read
--      access for the brand owner stayed already covered by the existing
--      Layer 1 client_isolation policy on brand_snapshots — verified in
--      0001_init.sql block "Layer 1 — Brand-private SELECT policies").
--      We add an explicit `realtime_read` policy that mirrors ownership so
--      the realtime publisher can deliver to the right client.

begin;

-- Replica identity FULL on the tables used for realtime stage transitions.
alter table public.brand_snapshots replica identity full;
alter table public.brand_profiles  replica identity full;

-- Be paranoid: ensure brand_snapshots has a SELECT policy mirroring brand
-- ownership, so the realtime authorisation hook accepts the subscriber's JWT.
do $$
begin
  drop policy if exists realtime_read on public.brand_snapshots;
  create policy realtime_read on public.brand_snapshots
    for select using (
      exists (
        select 1 from public.brand_profiles bp
        where bp.brand_id = brand_snapshots.brand_id
          and bp.auth_user_id = auth.uid()
      )
    );

  drop policy if exists realtime_read on public.brand_profiles;
  create policy realtime_read on public.brand_profiles
    for select using (auth_user_id = auth.uid());
end $$;

commit;
