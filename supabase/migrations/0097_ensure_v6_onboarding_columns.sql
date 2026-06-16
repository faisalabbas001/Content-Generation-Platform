-- Migration 0097 — Ensure all v6 onboarding columns exist
--
-- 0072_branddna_v6_fields.sql was NOT included in apply_0074_to_0094.sql,
-- meaning any Supabase project that applied migrations via the bundle script
-- is missing 25+ columns from the v6 onboarding form. This migration re-applies
-- all of them idempotently (ADD COLUMN IF NOT EXISTS everywhere).
--
-- Safe to run even if 0072 was already applied — every statement is IF NOT EXISTS.

begin;

-- ── Chapter 1 — Foundation ────────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists name_meaning        text null,
  add column if not exists hero_upload_url     text null,
  add column if not exists hero_why            text null,
  add column if not exists platforms           text[] null default '{}';

-- ── Chapter 2 — The Feel ──────────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists scale_minmax        smallint null,
  add column if not exists scale_quietloud     smallint null,
  add column if not exists scale_localglobal   smallint null,
  add column if not exists scale_tradmod       smallint null,
  add column if not exists brand_refs          text[] null default '{}',
  add column if not exists lifestyle           text null,
  add column if not exists price_nums          text null,
  add column if not exists emotions            text[] null default '{}';

-- ── Chapter 3 — The Voice ─────────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists archetype_family    text null,
  add column if not exists music               text null,
  add column if not exists music_link          text null,
  add column if not exists custom_restriction  text null,
  add column if not exists occasions_ranked    text[] null default '{}';

-- ── Chapter 4 — The Business ─────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists respected_brands    text null,
  add column if not exists respected_why       text null,
  add column if not exists goal                text null,
  add column if not exists problems            text[] null default '{}',
  add column if not exists social              text null;

-- ── Chapter 5 — The Vision ───────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists brand_assets_bundle jsonb[] null default '{}',
  add column if not exists vision              text null,
  add column if not exists vision_text         text null;

-- ── Optional confidence-boost fields ─────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists tagline             text null,
  add column if not exists cust_quote          text null,
  add column if not exists caption_ex          text null,
  add column if not exists custom_occasion     text null,
  add column if not exists metric              text null,
  add column if not exists scale_custom        text null,
  add column if not exists cust_desc           text null,
  add column if not exists anything            text null;

-- ── Lifecycle text column ─────────────────────────────────────────────────────
alter table public.brand_profiles
  add column if not exists lifecycle           text null;

-- ── products_list (also in 0081 bundle — idempotent) ─────────────────────────
alter table public.brand_profiles
  add column if not exists products_list       text null;

-- ── brand_refs safe check constraint (text[] column) ─────────────────────────
-- brand_refs column already defined as text[] above; no additional constraint needed.

-- ── Check constraints for scale sliders (add only if column is fresh) ────────
-- Using DO block so we can check if constraint already exists before adding
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'brand_profiles_scale_minmax_check'
      and conrelid = 'public.brand_profiles'::regclass
  ) then
    alter table public.brand_profiles
      add constraint brand_profiles_scale_minmax_check     check (scale_minmax     between 0 and 100),
      add constraint brand_profiles_scale_quietloud_check  check (scale_quietloud  between 0 and 100),
      add constraint brand_profiles_scale_localglobal_check check (scale_localglobal between 0 and 100),
      add constraint brand_profiles_scale_tradmod_check    check (scale_tradmod    between 0 and 100);
  end if;
end $$;

commit;
