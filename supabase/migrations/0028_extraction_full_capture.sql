-- 0028_extraction_full_capture.sql
--
-- Capture FULL extraction output (raw Apify response + compact normalised
-- summary) in queryable columns instead of a single opaque jsonb blob, and
-- enrich channel_profiles with the rich IG profile fields the persist-ig
-- route actually receives (biography, profile_pic, full_name, etc.).
--
-- Background:
--   • A06 v4 wrapper now returns { raw, normalised } per branch. The previous
--     persist-source-record code wrote { branch, data, skipped } — the new
--     code writes { branch, raw, normalised, skipped } but the status route
--     was still reading payload.data → IG/Website appeared "None" in the UI
--     even though Apify succeeded.
--   • channel_profiles only stored followers + handle. The IG details API
--     returns biography, full_name, profile_pic_url, external_url,
--     business_category, follows_count — all useful, all dropped on the floor.
--
-- This migration is purely additive: new nullable columns + helpful indexes.
-- Backward-compatible — old rows with raw_payload.data still readable by the
-- status route's fallback path.

-- ─────────────────────────────────────────────────────────────────────
-- 1. source_records — split raw_payload into explicit columns
-- ─────────────────────────────────────────────────────────────────────
--
-- raw_payload remains the single-source-of-truth jsonb (kept for back-compat
-- and as a fallback). The new columns let downstream readers (status route,
-- COO Pass 2, admin tooling) target the exact slice they need without
-- re-parsing the whole blob.

alter table public.source_records
  add column if not exists branch          text,
  add column if not exists skipped         boolean not null default false,
  add column if not exists raw             jsonb,         -- FULL untouched Apify / Places response
  add column if not exists normalised      jsonb;         -- compact summary (UI-friendly)

comment on column public.source_records.branch is
  'Lane that produced this row: instagram | website | places. Mirrors source_type but always set by A06.';
comment on column public.source_records.raw is
  'FULL Apify / Google Places response — every field, no normalisation. Used by COO Pass 2 + admin debug.';
comment on column public.source_records.normalised is
  'Compact summary used by the live extraction UI + review-form pre-fill.';

-- Backfill from existing rows (idempotent — only touches rows where raw IS NULL)
update public.source_records
   set branch     = coalesce(branch,     (raw_payload->>'branch')),
       skipped    = coalesce(skipped,    (raw_payload->>'skipped')::boolean, false),
       raw        = coalesce(raw,        raw_payload->'raw',  raw_payload->'data'),
       normalised = coalesce(normalised, raw_payload->'normalised')
 where raw is null or normalised is null or branch is null;

create index if not exists idx_source_records_brand_branch
  on public.source_records (brand_id, branch);

-- ─────────────────────────────────────────────────────────────────────
-- 2. channel_profiles — capture the rich IG profile fields
-- ─────────────────────────────────────────────────────────────────────
--
-- Apify Instagram details returns much more than followers + handle. Persist
-- everything that's brand-relevant so COO + the review form can read directly
-- from this table instead of re-parsing source_records.raw.

alter table public.channel_profiles
  add column if not exists full_name          text,
  add column if not exists biography          text,
  add column if not exists profile_pic_url    text,
  add column if not exists external_url       text,
  add column if not exists business_category  text,
  add column if not exists follows_count      int,
  add column if not exists is_private         boolean default false,
  add column if not exists joined_recently    boolean default false,
  add column if not exists has_channel        boolean default false,
  add column if not exists raw_profile        jsonb,    -- full Apify details object
  add column if not exists normalised_profile jsonb,    -- compact normalised view
  add column if not exists posts_sample       jsonb;    -- small sample (caption/likes/ts) for at-a-glance review

comment on column public.channel_profiles.raw_profile is
  'Full untouched Apify Instagram details object (latestIgtvVideos, relatedProfiles, etc.). Audit + reprocessing.';
comment on column public.channel_profiles.normalised_profile is
  'Compact view used by review-form / dashboards (handle, followers, business flags, top hashtags).';
comment on column public.channel_profiles.posts_sample is
  'Up to ~10 recent posts as { caption, likes, comments, timestamp } — quick visual check on the review screen.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. RLS — new columns inherit existing policies (jsonb is in the same
--    row, no separate grants needed).
-- ─────────────────────────────────────────────────────────────────────
