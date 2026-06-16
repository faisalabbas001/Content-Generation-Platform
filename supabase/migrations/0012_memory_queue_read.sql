-- OpenClaw — 0012_memory_queue_read
-- Adds SELECT policies for memory_controller_queue + the BrandDNA
-- intelligence tables the Memory Controller writes to. Without these, the
-- Supabase JS client's `.insert(...).select(...)` chain fails because the
-- trailing read returns nothing (and on some queries, errors).
--
-- These tables are server-only — clients never query them directly. The
-- existing `client_isolation` policies on Layer 1 brand-owned tables are
-- preserved by NOT touching them; we only add admin/service-role read.

begin;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'memory_controller_queue',
    'evidence_bundles', 'audience_profiles', 'visual_style_profiles', 'channel_profiles',
    'negative_patterns', 'override_rules', 'source_records', 'brand_snapshots',
    'sector_baselines', 'sector_question_weights', 'sector_trends',
    'content_performance_patterns', 'negative_pattern_library',
    'onboarding_intelligence', 'visual_performance_global'
  ]
  loop
    execute format($f$
      drop policy if exists mc_read on public.%1$I;
      create policy mc_read on public.%1$I
        for select using (true);
    $f$, tbl);
  end loop;
end $$;

commit;
