-- OpenClaw — 0013_revert_layer1_open_read
-- Migration 0012 mistakenly opened SELECT on Layer 1 brand-owned tables
-- (audience_profiles, visual_style_profiles, negative_patterns,
-- override_rules, source_records, brand_snapshots, evidence_bundles,
-- channel_profiles). That broke Layer 1 isolation per Doc §4.2 RLS rule
-- "brand_id = auth.uid()".
--
-- This migration drops the over-broad mc_read policy from Layer 1 tables.
-- We keep mc_read on:
--   - memory_controller_queue   (server-only — never read by clients)
--   - sector_*                  (Layer 2 — already public-readable per spec)
--   - content_performance_patterns + Layer 3 helpers (anonymous, public)

begin;

drop policy if exists mc_read on public.evidence_bundles;
drop policy if exists mc_read on public.audience_profiles;
drop policy if exists mc_read on public.visual_style_profiles;
drop policy if exists mc_read on public.channel_profiles;
drop policy if exists mc_read on public.negative_patterns;
drop policy if exists mc_read on public.override_rules;
drop policy if exists mc_read on public.source_records;
drop policy if exists mc_read on public.brand_snapshots;

-- Keep mc_read on the queue + Layer 2/3 (these are intentionally not
-- brand-isolated; Doc §4.3-4.4 makes them readable by all authenticated
-- agents and Phase-2 CIO).

commit;
