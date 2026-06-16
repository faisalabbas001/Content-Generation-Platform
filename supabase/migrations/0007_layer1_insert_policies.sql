-- OpenClaw — 0007_layer1_insert_policies
-- Doc §4 + §7.2 — Layer 1 INSERT policies, narrowly scoped to ownership.
--
-- Why: 0001 created SELECT and UPDATE policies on brand_profiles + Layer 1
-- tables, but no INSERT policy. With RLS enabled, missing-policy = blocked.
-- The doc's spirit (Hard Rule #2) reserves Layer 1 writes for the Memory
-- Controller — but the *bootstrap* row creation during onboarding has to
-- come from somewhere. N8N-A03 in production uses service_role; in Phase 1
-- pre-orchestration we let the user create their OWN row directly via the
-- server action, gated by RLS so they can never insert someone else's.
--
-- Permission opened (minimum-viable):
--   brand_profiles  → INSERT iff auth_user_id = auth.uid()
--   evidence_bundles, source_records, audience_profiles, visual_style_profiles,
--   channel_profiles, negative_patterns, override_rules, onboarding_responses,
--   brand_snapshots, brand_performance_log
--                  → INSERT iff brand_id belongs to a brand the user owns
-- Memory Controller / N8N still use service_role and bypass these limits.

begin;

-- 1. brand_profiles INSERT — only your own row.
drop policy if exists client_own_insert on public.brand_profiles;
create policy client_own_insert on public.brand_profiles
  for insert with check (auth_user_id = auth.uid());

-- 2. Layer 1 child tables — INSERT only if the brand is yours.
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'audience_profiles','visual_style_profiles','channel_profiles',
    'evidence_bundles','source_records','negative_patterns','override_rules',
    'onboarding_responses','brand_performance_log','brand_snapshots'
  ]
  loop
    execute format($f$
      drop policy if exists client_own_insert on public.%1$I;
      create policy client_own_insert on public.%1$I
        for insert with check (
          exists (
            select 1 from public.brand_profiles bp
            where bp.brand_id = %1$I.brand_id and bp.auth_user_id = auth.uid()
          )
        );

      drop policy if exists client_own_update on public.%1$I;
      create policy client_own_update on public.%1$I
        for update using (
          exists (
            select 1 from public.brand_profiles bp
            where bp.brand_id = %1$I.brand_id and bp.auth_user_id = auth.uid()
          )
        );
    $f$, tbl);
  end loop;
end $$;

commit;
