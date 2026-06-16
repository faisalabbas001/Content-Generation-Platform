-- Migration 0021 — Extend completeness score to 12 critical fields
--
-- v2 BrandDNA adds two load-bearing identity fields (archetype_primary,
-- lifecycle_stage). Both are tracked in evidence_bundles like the existing
-- 10. The completeness formula expands proportionally:
--
--   completeness_score = (qualified_critical_fields / 12) × 100
--
-- Why these two and not all four new axis fields:
--   • archetype_secondary is optional — counting it would penalize
--     single-archetype brands.
--   • intent_state is "the most fluid axis" (framework v2): can shift
--     month to month while the brand is otherwise fully known. Treating
--     it as completeness signal would make the score noisy.
--
-- This migration just rewrites compute_brand_completeness(); existing
-- callers (refresh_brand_completeness, Memory Controller) pick it up
-- without code changes.

begin;

create or replace function public.compute_brand_completeness(p_brand_id uuid)
returns int
language sql
stable
as $$
  with critical as (
    select unnest(array[
      -- Original BrandDNA Lite (10)
      'arabic_dialect',
      'brand_differentiator',
      'price_position',
      'primary_channel',
      'ramadan_relevance',
      'primary_audience_gender',
      'primary_kpi_type',
      'religious_sensitivity',
      'tone_anti_attribute_ids',
      'bilingual_ratio',
      -- v2 axis additions (2)
      'archetype_primary',
      'lifecycle_stage'
    ]) as field_name
  ),
  qualified as (
    select distinct eb.field_name
      from evidence_bundles eb
      join critical c on c.field_name = eb.field_name
     where eb.brand_id = p_brand_id
       and eb.field_confidence::text in (
         'inferred_medium',
         'inferred_high',
         'evidence_weak',
         'evidence_strong',
         'explicitly_confirmed'
       )
  )
  select greatest(0, least(100, ((count(*)::float / 12.0) * 100)::int))
    from qualified
$$;

commit;
