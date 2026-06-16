-- Migration 0019 — completeness_score recompute function
--
-- Doc §4.5 ("How BrandDNA Learns"): the score must reflect the CURRENT
-- evidence state, not just the onboarding snapshot. After every Memory
-- Controller write that changes a field's confidence — A04 corrections,
-- D02 maintenance downgrades, A03 onboarding — we recompute.
--
-- Formula (matches packages/core/src/brand/critical-fields.ts):
--   completeness_score = (
--       count(distinct field_name from evidence_bundles
--             where field_name in <CRITICAL_BRANDDNA_FIELDS>
--               and field_confidence in <COMPLETENESS_QUALIFYING_STATES>
--               and brand_id = $1)
--       / 10.0
--   ) * 100
--
-- Returns an integer 0–100. Caller is responsible for UPDATEing
-- brand_profiles.completeness_score with the result. We do NOT update inside
-- the function so callers retain control of audit + idempotency.

begin;

create or replace function public.compute_brand_completeness(p_brand_id uuid)
returns int
language sql
stable
as $$
  with critical as (
    select unnest(array[
      'arabic_dialect',
      'brand_differentiator',
      'price_position',
      'primary_channel',
      'ramadan_relevance',
      'primary_audience_gender',
      'primary_kpi_type',
      'religious_sensitivity',
      'tone_anti_attribute_ids',
      'bilingual_ratio'
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
  select greatest(0, least(100, ((count(*)::float / 10.0) * 100)::int))
    from qualified
$$;

-- Convenience: a one-shot procedure that recomputes AND writes back.
-- Memory Controller calls this from JS, but having it as SQL too means
-- ops can run it manually for debugging.
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

-- Phase-2 placeholder: when CIO is added, it will need to call this from
-- D02 maintenance + A05 monthly cycle. Leaving the functions service-role
-- only (default) — no API route exposes them. Memory Controller calls them
-- via the pg-bypass client.

commit;
