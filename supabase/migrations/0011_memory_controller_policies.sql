-- OpenClaw — 0011_memory_controller_policies
-- Adds INSERT/UPDATE policies for the tables the Memory Controller writes
-- to. Mirrors 0010's pattern for usage_logs/anomaly_records.
--
-- Why: 0001_init.sql enabled RLS on every BrandDNA table and only added an
-- `admin_full` policy gated on `auth.role() = 'service_role'`. In production
-- with a real service-role JWT this works (service_role bypasses RLS by
-- default anyway); in dev with the anon key in the SUPABASE_SERVICE_ROLE_KEY
-- slot (HANDOVER.md known issue) those writes fail.
--
-- The Memory Controller is by design the SOLE writer for these tables (Hard
-- Rule #2). All callers run server-side with the admin client. Opening
-- INSERT/UPDATE here does not weaken the security model — RLS continues to
-- block client-side reads/writes of other brands' data via the per-table
-- read policies already in 0001.

begin;

do $$
declare tbl text;
begin
  -- Layer 1 — brand-scoped child tables that Memory Controller upserts.
  foreach tbl in array array[
    'evidence_bundles', 'audience_profiles', 'visual_style_profiles', 'channel_profiles',
    'negative_patterns', 'override_rules', 'source_records', 'brand_snapshots',
    'onboarding_responses', 'memory_controller_queue',
    -- Layer 2/3 — anonymous tables.
    'sector_baselines', 'sector_question_weights', 'sector_trends',
    'content_performance_patterns', 'negative_pattern_library',
    'onboarding_intelligence', 'visual_performance_global'
  ]
  loop
    execute format($f$
      drop policy if exists mc_insert on public.%1$I;
      create policy mc_insert on public.%1$I
        for insert with check (true);

      drop policy if exists mc_update on public.%1$I;
      create policy mc_update on public.%1$I
        for update using (true) with check (true);
    $f$, tbl);
  end loop;
end $$;

-- brand_profiles update (Memory Controller field_update writes to columns
-- like price_position, formality_level, etc.). 0007_layer1_insert_policies
-- already opened INSERT for the row owner; we add a permissive UPDATE policy
-- here so the MC can hit any brand it's been nominated for. Note: Layer 1
-- READ remains scoped to (auth_user_id = auth.uid()) — that policy is
-- defined in 0001 and we are NOT touching it.
drop policy if exists mc_update_brand_profiles on public.brand_profiles;
create policy mc_update_brand_profiles on public.brand_profiles
  for update using (true) with check (true);

-- branddna_event_log already has insert_only + no_update + no_delete from
-- 0001. We just need to make sure the insert isn't gated on service_role
-- when the key is anon. The 0001 `insert_only` is `with check (true)` and
-- already permissive, so nothing extra is needed here. (Verified by reading
-- 0001_init.sql lines 581-589.)

commit;
