-- Migration 0060 — BrandDNA Phase 1 gaps
--
-- Adds missing Layer 1, 2, and 3 fields identified from OGZ_COMPLETE_SYSTEM_DOCUMENT:
--   Layer 1: sub_sector, region_primary, founded_year, tone_register
--   Layer 2: communication_style, brand_goals
--   Layer 3: posting_rhythm, caption_style

begin;

-- Layer 1 — Brand Identity
alter table public.brand_profiles
  add column if not exists sub_sector         text null,
  add column if not exists region_primary     text null,
  add column if not exists founded_year       integer null,
  add column if not exists tone_register      text null;

comment on column public.brand_profiles.sub_sector      is 'Layer 1: Finer-grained sector (e.g. "Fine Dining" within F&B)';
comment on column public.brand_profiles.region_primary  is 'Layer 1: Saudi region — Najdi, Hejazi, Eastern, Southern, Other';
comment on column public.brand_profiles.founded_year    is 'Layer 1: Year the brand was founded — affects permission level and tone';
comment on column public.brand_profiles.tone_register   is 'Layer 1: Tone register — Traditional, Modern, Youth, Mixed';

-- Layer 2 — Owner Profile
alter table public.brand_profiles
  add column if not exists communication_style text null,
  add column if not exists brand_goals         text null;

comment on column public.brand_profiles.communication_style is 'Layer 2: How the owner naturally communicates (distinct from way_of_speaking)';
comment on column public.brand_profiles.brand_goals         is 'Layer 2: Short-term business goals beyond goal_phase enum';

-- Layer 3 — Visual and Content Identity
alter table public.brand_profiles
  add column if not exists posting_rhythm text null,
  add column if not exists caption_style  text null;

comment on column public.brand_profiles.posting_rhythm is 'Layer 3: How frequently the brand posts — daily, 3x/week, weekly, etc.';
comment on column public.brand_profiles.caption_style  is 'Layer 3: Brand-specific caption style preference — short_punchy, long_storytelling, question_hook, cta_heavy';

commit;
