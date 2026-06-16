-- Migration 0084 — Update completeness function to count 12 critical fields
--
-- Migration 0019 hard-coded 10 fields and divided by 10.0.
-- packages/core/src/brand/critical-fields.ts now lists 12 fields (added
-- archetype_primary and lifecycle_stage in the v2 axis update).
-- The JS-side computeCompletenessScore() already uses 12; the SQL function
-- still uses 10 → DB-side scores are inflated by 20 points for fully-filled
-- brands, and the Memory Controller's refreshCompletenessScore() (which calls
-- this SQL) returns wrong values.
--
-- This migration replaces both SQL functions to use 12 fields and divide
-- by 12.0. Also adds archetype_primary and lifecycle_stage to the qualifying
-- field list, and removes stale evidence states ('evidence_weak',
-- 'evidence_strong') that don't exist in the field_confidence_type enum.

begin;

create or replace function public.compute_brand_completeness(p_brand_id uuid)
returns int
language sql
stable
as $$
  with critical as (
    select unnest(array[
      -- Original 10 BrandDNA Lite fields (Doc §6.2)
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
      -- v2 axis additions (load-bearing per framework v2)
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
         'explicitly_confirmed'
       )
  )
  select greatest(0, least(100, ((count(*)::float / 12.0) * 100)::int))
    from qualified
$$;

-- Also update the convenience procedure so manual ops get the right answer
create or replace function public.refresh_brand_completeness(p_brand_id uuid)
returns int
language plpgsql
as $$
declare
  v_score int;
begin
  select public.compute_brand_completeness(p_brand_id) into v_score;
  update public.brand_profiles
     set completeness_score = v_score,
         updated_at         = now()
   where brand_id = p_brand_id;
  return v_score;
end
$$;

-- Backfill: recompute all existing brands so their stored scores reflect the
-- new 12-field formula immediately (not just on the next Memory Controller write).
do $$
declare
  r record;
begin
  for r in select brand_id from public.brand_profiles loop
    perform public.refresh_brand_completeness(r.brand_id);
  end loop;
end $$;

commit;
