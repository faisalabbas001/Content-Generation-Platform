-- Migration 0072 — BrandDNA v6 onboarding fields
--
-- Adds all columns required by the 20-question v6 onboarding spec that are
-- missing from the current schema.  All columns are nullable — existing brands
-- are not broken.  Idempotent (ADD COLUMN IF NOT EXISTS everywhere).
--
-- Chapters / families covered:
--   Ch 1 Foundation  (Q1-4)  : name_meaning, hero_upload_url, hero_why, platforms
--   Ch 2 The Feel    (Q5-9)  : scale_minmax/quietloud/localglobal/tradmod, brand_refs,
--                              lifestyle, emotions, price_nums (actual SAR range)
--   Ch 3 The Voice   (Q10-14): archetype_family, archetype_primary (already exists),
--                              music, music_link, custom_restriction, occasions_ranked
--   Ch 4 The Business(Q15-18): respected_brands, respected_why, goal, problems,
--                              social (all platform handles)
--   Ch 5 The Vision  (Q19-20): brand_assets_bundle, vision, vision_text,
--                              tagline, cust_quote, caption_ex, custom_occasion,
--                              metric, anything, scale_custom, cust_desc

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Chapter 1 — Foundation
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  -- Q1: brand name meaning / subtitle
  add column if not exists name_meaning        text null,
  -- Q2: hero product image URL + why copy
  add column if not exists hero_upload_url     text null,
  add column if not exists hero_why            text null,
  -- Q4: all platforms the brand is active on (multi-select array)
  add column if not exists platforms           text[] null default '{}';

comment on column public.brand_profiles.name_meaning    is 'Ch1/Q1: Short brand story or meaning behind the name';
comment on column public.brand_profiles.hero_upload_url is 'Ch1/Q2: Hero product image public URL (uploaded during onboarding)';
comment on column public.brand_profiles.hero_why        is 'Ch1/Q2: Why this is the hero product — the one-liner';
comment on column public.brand_profiles.platforms       is 'Ch1/Q4: All active platforms e.g. ["Instagram","TikTok","Snapchat"]';

-- ─────────────────────────────────────────────────────────────────────────────
-- Chapter 2 — The Feel
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  -- Q5: brand aesthetic sliders (0-100 each)
  add column if not exists scale_minmax        smallint null check (scale_minmax       between 0 and 100),
  add column if not exists scale_quietloud     smallint null check (scale_quietloud    between 0 and 100),
  add column if not exists scale_localglobal   smallint null check (scale_localglobal  between 0 and 100),
  add column if not exists scale_tradmod       smallint null check (scale_tradmod      between 0 and 100),
  -- Q6: admired brand references (array of up to 3 brand names)
  add column if not exists brand_refs          text[] null default '{}',
  -- Q7: lifestyle scene
  add column if not exists lifestyle           text null,
  -- Q8: actual price range string e.g. "SAR 30-80"
  add column if not exists price_nums          text null,
  -- Q9: emotion tags (array of up to 3 emotion labels)
  add column if not exists emotions            text[] null default '{}';

comment on column public.brand_profiles.scale_minmax      is 'Ch2/Q5: Minimal(0)–Maximal(100) aesthetic slider';
comment on column public.brand_profiles.scale_quietloud   is 'Ch2/Q5: Quiet(0)–Loud(100) aesthetic slider';
comment on column public.brand_profiles.scale_localglobal is 'Ch2/Q5: Local(0)–Global(100) aesthetic slider';
comment on column public.brand_profiles.scale_tradmod     is 'Ch2/Q5: Traditional(0)–Modern(100) aesthetic slider';
comment on column public.brand_profiles.brand_refs        is 'Ch2/Q6: Up to 3 admired brand names used as aesthetic references';
comment on column public.brand_profiles.lifestyle         is 'Ch2/Q7: Lifestyle scene key e.g. family_home, coffee_solo, mall_friends';
comment on column public.brand_profiles.price_nums        is 'Ch2/Q8: Actual price range string e.g. "SAR 30–80"';
comment on column public.brand_profiles.emotions          is 'Ch2/Q9: Up to 3 emotion labels e.g. ["Inspired","Proud","Calm"]';

-- ─────────────────────────────────────────────────────────────────────────────
-- Chapter 3 — The Voice
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  -- Q10: archetype family (hero/caregiver/explorer/creator) — first step of 2-step picker
  add column if not exists archetype_family    text null,
  -- Q11: music mood key + optional link
  add column if not exists music               text null,
  add column if not exists music_link          text null,
  -- Q12: custom restriction (free-text beyond preset list)
  add column if not exists custom_restriction  text null,
  -- Q14: top-3 occasions ranked as ordered array
  add column if not exists occasions_ranked    text[] null default '{}';

comment on column public.brand_profiles.archetype_family   is 'Ch3/Q10: Archetype family step-1 key: hero|caregiver|explorer|creator';
comment on column public.brand_profiles.music              is 'Ch3/Q11: Music mood key e.g. acoustic|arabic|pop|cinematic|lofi|energy';
comment on column public.brand_profiles.music_link         is 'Ch3/Q11: Optional reference track URL';
comment on column public.brand_profiles.custom_restriction is 'Ch3/Q12: Free-text restriction beyond the preset 13 options';
comment on column public.brand_profiles.occasions_ranked   is 'Ch3/Q14: Top 3 occasions in ranked order e.g. ["Ramadan","Eid Al-Fitr","Saudi National Day"]';

-- ─────────────────────────────────────────────────────────────────────────────
-- Chapter 4 — The Business
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  -- Q15: respected brand names + why
  add column if not exists respected_brands    text null,
  add column if not exists respected_why       text null,
  -- Q16: primary goal key
  add column if not exists goal                text null,
  -- Q17: content problems that didn't work (multi-select array)
  add column if not exists problems            text[] null default '{}',
  -- Q18: founding story (already exists as founding_story from migration 0043)
  -- Q?:  social handles string (all platforms in one field)
  add column if not exists social              text null;

comment on column public.brand_profiles.respected_brands is 'Ch4/Q15: Names of 1-2 admired brands (not competitors)';
comment on column public.brand_profiles.respected_why    is 'Ch4/Q15: Why those brands are admired';
comment on column public.brand_profiles.goal             is 'Ch4/Q16: Primary content goal key: orders|awareness|launch|community|trust';
comment on column public.brand_profiles.problems         is 'Ch4/Q17: Content problems encountered e.g. ["Too generic","Low engagement"]';
comment on column public.brand_profiles.social           is 'All social handles in a single free-text field for discoverability';

-- ─────────────────────────────────────────────────────────────────────────────
-- Chapter 5 — The Vision
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  -- Q19: multi-file brand asset bundle (array of JSONB objects {url, name, mime, size})
  add column if not exists brand_assets_bundle jsonb[] null default '{}',
  -- Q20: vision key + free-text expansion
  add column if not exists vision              text null,
  add column if not exists vision_text         text null;

comment on column public.brand_profiles.brand_assets_bundle is 'Ch5/Q19: Brand asset files uploaded [{url,name,mime,size}] up to 10';
comment on column public.brand_profiles.vision              is 'Ch5/Q20: Vision key: customers|recognition|community|premium';
comment on column public.brand_profiles.vision_text         is 'Ch5/Q20: Free-text vision expansion';

-- ─────────────────────────────────────────────────────────────────────────────
-- Confidence-boost optional fields (from calcConf in v6 spec)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists tagline             text null,
  add column if not exists cust_quote          text null,
  add column if not exists caption_ex          text null,
  add column if not exists custom_occasion     text null,
  add column if not exists metric              text null,
  add column if not exists scale_custom        text null,
  add column if not exists cust_desc           text null,
  add column if not exists anything            text null;

comment on column public.brand_profiles.tagline          is 'Optional: brand tagline / slogan';
comment on column public.brand_profiles.cust_quote       is 'Optional: a real customer quote about the brand';
comment on column public.brand_profiles.caption_ex       is 'Optional: example caption the brand loves';
comment on column public.brand_profiles.custom_occasion  is 'Optional: a custom occasion not in the preset list';
comment on column public.brand_profiles.metric           is 'Optional: the one metric that determines success';
comment on column public.brand_profiles.scale_custom     is 'Optional: free-text custom scale description';
comment on column public.brand_profiles.cust_desc        is 'Optional: custom description of the target customer';
comment on column public.brand_profiles.anything         is 'Optional: anything else the brand owner wants to share';

-- ─────────────────────────────────────────────────────────────────────────────
-- lifecycle_stage column — from v6 Q3 lifecycle picker (re-labels existing enum)
-- brand_profiles already has lifecycle_stage from 0014 if present; ensure it
-- also accepts the v6 string values via a text column fallback.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists lifecycle           text null;

comment on column public.brand_profiles.lifecycle is 'Ch1/Q3 (v6): Lifecycle stage key: launch|growth|established|mature|legacy';

commit;
