-- Migration 0023 — Complete the composition_matrix to full 300-tuple coverage.
--
-- Background:
--   Migration 0020 seeded 8 documented Saudi-SME tuples × 6 methods = 48 rows.
--   The Three-Axis Framework v2 spec calls for a full 12 archetypes ×
--   5 lifecycle stages × 5 intent states = 300 tuples, each with a score for
--   all 6 creative methods → 1,800 rows total.
--
--   With only 48 rows seeded, COO Pass 4's `decideComposition()` falls back
--   to the Vulnerability Method for 292 of 300 tuples (97% of brands). That
--   makes the matrix functionally inert for most onboarding flows.
--
-- Approach:
--   Generate the remaining 1,752 rows algorithmically using the deterministic
--   scoring heuristics from the framework spec. The 48 already-seeded rows
--   are PRESERVED via ON CONFLICT DO NOTHING — we never overwrite an
--   editorial-verified score with a heuristic one.
--
-- Heuristics encode (per framework §"Composition Matrix"):
--   • Authenticity     → universal default, score 60–80 across most tuples
--   • Vulnerability    → high for Launch + Caregiver/Everyman/Hero/Innocent,
--                        AND for Refresh_Relaunch (returning from a gap)
--                        Low for Ruler/Sage at Maturity (authority is the asset)
--   • Heritage         → high for Sage/Ruler/Creator at Maturity
--                        Low at Launch (no heritage to claim yet)
--   • Paradox          → high for Magician/Outlaw/Hero
--                        Low for Caregiver/Sage at Maturity
--   • Diagnostic       → high for Sage/Ruler/Hero at Establishment+
--                        Medium for Conversion_Promotional intent
--   • Metaphor         → high for Lover/Creator/Magician/Jester
--                        Low for Ruler/Sage (too playful)
--
-- Idempotent — safe to re-run.

begin;

insert into public.composition_matrix (archetype, lifecycle_stage, intent_state, method, score)
select
  a.archetype,
  l.lifecycle,
  i.intent,
  m.method,
  -- Compute score deterministically per (archetype, lifecycle, intent, method)
  case m.method
    -- ────────────────────────────────────────────────────────────────
    -- AUTHENTICITY — the universal default. Strong baseline everywhere.
    -- ────────────────────────────────────────────────────────────────
    when 'Authenticity' then case
      when l.lifecycle = 'Launch'        then 78
      when l.lifecycle = 'Renewal'       then 80  -- comeback honesty
      when l.lifecycle = 'Maturity' and a.archetype in ('Sage','Ruler','Creator') then 85
      when l.lifecycle = 'Maturity'      then 75
      when i.intent    = 'Brand_Building' then 75
      when i.intent    = 'Differentiation_Loyalty' then 80
      else 70
    end

    -- ────────────────────────────────────────────────────────────────
    -- VULNERABILITY — Launch SMEs default; comeback narratives.
    -- ────────────────────────────────────────────────────────────────
    when 'Vulnerability' then case
      -- Strong launch signal for human-first archetypes
      when l.lifecycle = 'Launch' and a.archetype in ('Caregiver','Everyman','Hero','Innocent') then 85
      when l.lifecycle = 'Launch' and a.archetype in ('Lover','Jester','Explorer') then 75
      when l.lifecycle = 'Launch' then 65
      -- Renewal — coming back is the story
      when l.lifecycle = 'Renewal' then 80
      when i.intent = 'Refresh_Relaunch' then 78
      -- Established + Maturity for AUTHORITY archetypes — vulnerability is a tone betrayal
      when l.lifecycle in ('Maturity','Transition') and a.archetype in ('Sage','Ruler') then 25
      when l.lifecycle in ('Maturity','Transition') and a.archetype = 'Creator' then 40
      when l.lifecycle = 'Maturity' then 50
      -- Growth — moderate
      else 55
    end

    -- ────────────────────────────────────────────────────────────────
    -- HERITAGE — earned authority. Strongest at Maturity.
    -- ────────────────────────────────────────────────────────────────
    when 'Heritage' then case
      when l.lifecycle = 'Maturity' and a.archetype in ('Sage','Ruler','Creator') then 85
      when l.lifecycle = 'Maturity' and a.archetype in ('Caregiver','Hero') then 70
      when l.lifecycle = 'Maturity' then 55
      when l.lifecycle = 'Transition' then 60
      when l.lifecycle = 'Growth' and a.archetype in ('Sage','Ruler') then 60
      when l.lifecycle = 'Growth' then 45
      -- Launch — no heritage yet
      when l.lifecycle = 'Launch' then 25
      -- Renewal — heritage is what's being relaunched
      when l.lifecycle = 'Renewal' then 65
      else 40
    end

    -- ────────────────────────────────────────────────────────────────
    -- PARADOX — provocative reframe. Strongest for transformative archetypes.
    -- ────────────────────────────────────────────────────────────────
    when 'Paradox' then case
      when a.archetype in ('Magician','Outlaw','Hero') then case
        when l.lifecycle = 'Growth' then 85
        when l.lifecycle = 'Launch' then 78
        when l.lifecycle = 'Maturity' then 70
        else 65
      end
      when a.archetype in ('Lover','Jester','Explorer') then case
        when l.lifecycle in ('Growth','Maturity') then 70
        else 60
      end
      -- Caregiver/Sage at Maturity — paradox feels off-brand
      when a.archetype in ('Caregiver','Sage') and l.lifecycle = 'Maturity' then 30
      when a.archetype = 'Innocent' then 35
      when i.intent = 'Differentiation_Loyalty' then 60
      else 50
    end

    -- ────────────────────────────────────────────────────────────────
    -- DIAGNOSTIC — fact-based, often Conversion-aligned.
    -- ────────────────────────────────────────────────────────────────
    when 'Diagnostic' then case
      when a.archetype in ('Sage','Ruler','Hero') and l.lifecycle in ('Maturity','Transition') then 75
      when a.archetype in ('Sage','Ruler') then 65
      when i.intent = 'Conversion_Promotional' then case
        when a.archetype in ('Sage','Ruler','Hero','Caregiver') then 75
        else 60
      end
      when i.intent = 'Awareness_Attraction' then 55
      -- Lover/Jester — diagnostic is too dry
      when a.archetype in ('Lover','Jester') then 35
      when l.lifecycle = 'Launch' then 50
      else 55
    end

    -- ────────────────────────────────────────────────────────────────
    -- METAPHOR — emotional/poetic. Strongest for Lover/Creator/Magician.
    -- ────────────────────────────────────────────────────────────────
    when 'Metaphor' then case
      when a.archetype in ('Lover','Creator','Magician','Jester') then case
        when l.lifecycle in ('Growth','Maturity') then 70
        else 60
      end
      -- Ruler/Sage — too ornate, undermines authority
      when a.archetype in ('Ruler','Sage') then 25
      when a.archetype = 'Caregiver' then 25
      when i.intent = 'Brand_Building' then 50
      when i.intent = 'Conversion_Promotional' then case
        when a.archetype = 'Lover' then 68
        else 45
      end
      else 40
    end

    else 50
  end
from
  -- All 12 archetypes
  unnest(enum_range(null::archetype_type)) as a(archetype)
  -- All 5 lifecycle stages
  cross join unnest(enum_range(null::lifecycle_stage_type)) as l(lifecycle)
  -- All 5 intent states
  cross join unnest(enum_range(null::intent_state_type)) as i(intent)
  -- All 6 methods
  cross join unnest(enum_range(null::creative_method_type)) as m(method)
on conflict (archetype, lifecycle_stage, intent_state, method) do nothing;

-- Verify final count
do $$
declare
  row_count int;
  expected_tuples int := 12 * 5 * 5;        -- 300
  expected_rows   int := expected_tuples * 6; -- 1,800
begin
  select count(*) into row_count from public.composition_matrix;
  if row_count <> expected_rows then
    raise exception 'composition_matrix has % rows, expected % (300 tuples x 6 methods)', row_count, expected_rows;
  end if;
  raise notice 'composition_matrix populated: % rows (% tuples x 6 methods)', row_count, expected_tuples;
end $$;

commit;
