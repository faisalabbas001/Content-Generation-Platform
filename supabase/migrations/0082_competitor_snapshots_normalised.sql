-- Migration 0082: Add normalised column to competitor_snapshots
--
-- Mirrors the source_records pattern (raw + normalised split) so competitor
-- extraction data can be queried structurally without parsing raw_payload.
--
-- normalised shape (written by N8N-A07 after Apify run):
-- {
--   profile: {
--     username, full_name, followers_count, follows_count,
--     posts_count_total, biography, is_verified, is_business_account,
--     business_category, profile_pic_url
--   },
--   posts_sample: [{ caption, likes, comments, timestamp, display_url }],
--   captions_for_dialect: string[],
--   lifecycle_signals: {
--     account_age_months, post_count, post_frequency_30d, followers_count
--   }
-- }
--
-- This is the same normalised shape used in source_records for the brand's
-- own Instagram lane, so the same downstream consumers (COO, caption context,
-- BrandDNA comparisons) can read competitor data with zero extra parsing.

alter table public.competitor_snapshots
  add column if not exists normalised jsonb;

comment on column public.competitor_snapshots.normalised is
  'Structured extraction result — same shape as source_records.normalised for the instagram lane. Written by N8N-A07 alongside raw_payload.';
