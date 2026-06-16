-- Migration 0089 — Fill competitor_snapshots column gaps
--
-- The gap analysis identified two missing analytical columns on
-- competitor_snapshots (migration 0076):
--   • occasion_approach — how this competitor handles Saudi occasions
--     (same structure as brand_profiles.occasion_approach)
--   • engagement_by_content_type — engagement breakdown by content category
--     so COO can compare competitor performance per content type vs. the brand
--
-- Both are written by N8N-A07 after Apify extraction + pattern analysis.
-- The normalised column (0082) stores the structured IG extraction; these
-- columns store the derived analytics on top of it.

begin;

alter table public.competitor_snapshots
  add column if not exists occasion_approach          jsonb,
  -- Format: {"ramadan": "full", "national_day": "reduced", "eid_fitr": "minimal"}
  -- Values per occasion: "full" | "reduced" | "minimal" | "none"

  add column if not exists engagement_by_content_type jsonb;
  -- Format: {"product": 0.045, "lifestyle": 0.038, "occasion": 0.062, "behind_scenes": 0.029}
  -- Keys = content_category_distribution keys; values = avg engagement rate per type

comment on column public.competitor_snapshots.occasion_approach is
  'How this competitor engages with Saudi occasions: {occasion: "full"|"reduced"|"minimal"|"none"}. Written by N8N-A07.';

comment on column public.competitor_snapshots.engagement_by_content_type is
  'Average engagement rate broken down by content category. Enables COO to compare competitor performance per content type. Written by N8N-A07.';

commit;
