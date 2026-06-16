-- Migration 0081 — BrandDNA Schema Cleanup
--
-- 1. Drop duplicate lifecycle columns:
--    - lifecycle_stage (enum from 0020) is superseded by lifecycle (text from 0072)
--      which uses the same key set (launch|growth|established|mature|legacy).
--      The text column is more flexible and is what the COO and form use.
--    - lifecycle_stage stays as an alias view for any legacy queries.
--
-- 2. Drop archetype_secondary — never used in any agent, prompt, or UI.
--    archetype_primary is the one the COO writes.
--
-- 3. Drop business_events JSONB column on brand_profiles — superseded by the
--    normalised public.business_events table (created in 0043). Both existed.
--
-- 4. All drops use IF EXISTS — safe to re-run.

begin;

-- ── 1. Drop lifecycle_stage (keep lifecycle text column) ──────────────────────
-- Update existing rows: copy lifecycle_stage → lifecycle before dropping
update public.brand_profiles
  set lifecycle = lifecycle_stage::text
  where lifecycle is null and lifecycle_stage is not null;

alter table public.brand_profiles
  drop column if exists lifecycle_stage;

-- Drop the enum too if nothing else uses it
-- (DO block to avoid error if other tables reference it — unlikely but safe)
do $$ begin
  drop type if exists lifecycle_stage_type;
exception when others then null; end $$;

-- ── 2. Drop archetype_secondary ───────────────────────────────────────────────
alter table public.brand_profiles
  drop column if exists archetype_secondary;

-- ── 3. Drop business_events JSONB column ──────────────────────────────────────
-- The normalised table public.business_events (created in 0043) is the source
-- of truth. This JSONB column on brand_profiles duplicated it.
alter table public.brand_profiles
  drop column if exists business_events;

-- ── 4. Drop rarely-used Layer 4 fields that COO should own, not the user ──────
-- These are all computed by COO buildBrandDna after extraction.
-- Removing from brand_profiles forces all writes through Memory Controller.
-- creative_formulas_approved → COO/Memory Controller writes this
-- content_mix_ratios         → COO derives from sector + intent
-- platform_weights           → COO derives from channel_profiles
-- occasion_approach          → COO derives from occasion_intelligence
-- strategy_version           → maintained by system, not user input
alter table public.brand_profiles
  drop column if exists creative_formulas_approved,
  drop column if exists content_mix_ratios,
  drop column if exists platform_weights,
  drop column if exists occasion_approach,
  drop column if exists strategy_version;

-- ── 5. Drop Layer 2 / 3 fields that belong to dashboard progressive capture ───
-- These were in the old 6-tab onboarding form but per the OGZ spec §3.2 Step 5
-- they are captured through the ongoing chat tab, not the onboarding form.
-- Removing them from brand_profiles does NOT delete the data — these fields
-- move to the owner_profile JSONB on brand_profiles which the chat updates.
-- We keep the columns that came from 0043/0059 but mark them dashboard-only.
-- EXCEPTION: founding_story is asked in onboarding (Step 5 of spec) — KEEP IT.
-- comfort_on_camera, way_of_speaking, communication_style, brand_goals,
-- posting_rhythm, caption_style, physical_appearance_notes → dashboard/chat only.
-- We leave them in the schema (they are cheap storage) but stop collecting them
-- during onboarding. The onboarding form simply won't send them anymore.
-- No DROP needed — the columns stay, they just won't be written by submitFinal.

-- ── 6. Add products_list column (new from doc Q02) ────────────────────────────
alter table public.brand_profiles
  add column if not exists products_list text null;

comment on column public.brand_profiles.products_list is
  'Doc Q02: Main products or services with prices — free text from onboarding';

-- ── 7. Ensure audience_gender_mix is not duplicated ──────────────────────────
-- brand_profiles has audience_gender_mix JSONB (mig 0014) AND audience_profiles
-- has gender_mix JSONB (canonical). We keep audience_gender_mix as a denorm
-- cache for fast CEO/COO reads but add a comment to clarify.
comment on column public.brand_profiles.audience_gender_mix is
  'Denorm cache of audience_profiles.gender_mix — written by submitFinal, updated by Memory Controller';

commit;
