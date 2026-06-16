-- Migration 0024 — Convert composition_matrix to WIDE FORMAT + canonical enum names.
--
-- Aligns the database with OpenClaw_CreativeDirection_Framework_v2.html:
--   • Lifecycle stages: pre_launch, launch, growth, maturity, recovery
--     (was: Launch, Growth, Maturity, Transition, Renewal)
--   • Intent states:    launch, grow, defend, harvest, recover
--     (was: Brand_Building, Awareness_Attraction, Differentiation_Loyalty,
--           Conversion_Promotional, Refresh_Relaunch)
--
-- Old → new value mapping:
--   lifecycle_stage_type:
--     Launch       → launch
--     Growth       → growth
--     Maturity     → maturity
--     Transition   → recovery   (transition into recovery semantically closest)
--     Renewal      → recovery   (per doc: "post-crisis comeback")
--     [new]        → pre_launch (no old value mapped here — legitimate gap)
--   intent_state_type:
--     Brand_Building          → launch    ("establish that you exist")
--     Awareness_Attraction    → grow      ("expand reach")
--     Differentiation_Loyalty → defend    ("protect position")
--     Conversion_Promotional  → harvest   ("convert into revenue")
--     Refresh_Relaunch        → recover   ("re-engage after dormancy")
--
-- New table shape: wide format — one row per (archetype × lifecycle × intent)
-- with 6 method-score columns + recommended_method + hybrid_composition.
--
-- recommended_method rule:
--   • If max(score) >= 80 → recommended_method = that method, is_hybrid = false
--   • Else                → recommended_method = NULL, is_hybrid = true,
--                           hybrid_composition = top-3 methods by score
--
-- Idempotent: drops the old table + types and rebuilds. Brand_profiles
-- values are remapped to the new enum names atomically.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- Phase A — capture the existing 1,800 long-format rows into a temp table
-- using OLD enum values (so we can pivot in Phase C after we change types)
-- ─────────────────────────────────────────────────────────────────────

create temp table _matrix_long_old as
  select
    archetype::text       as archetype,
    lifecycle_stage::text as old_lifecycle,
    intent_state::text    as old_intent,
    method::text          as method,
    score
  from public.composition_matrix;

-- Quick sanity check
do $$
declare
  n int;
begin
  select count(*) into n from _matrix_long_old;
  if n <> 1800 then
    raise exception 'Expected 1800 rows in old composition_matrix, got %', n;
  end if;
  raise notice 'Captured % rows from old composition_matrix', n;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- Phase B — change brand_profiles columns + composition_matrix to TEXT
-- so we can drop the old enums safely.
-- ─────────────────────────────────────────────────────────────────────

drop table public.composition_matrix;

alter table public.brand_profiles
  alter column lifecycle_stage type text using lifecycle_stage::text,
  alter column intent_state    type text using intent_state::text;

-- ─────────────────────────────────────────────────────────────────────
-- Phase C — drop old enum types, create new ones with canonical names.
-- ─────────────────────────────────────────────────────────────────────

drop type if exists public.lifecycle_stage_type;
drop type if exists public.intent_state_type;

create type public.lifecycle_stage_type as enum (
  'pre_launch',
  'launch',
  'growth',
  'maturity',
  'recovery'
);

create type public.intent_state_type as enum (
  'launch',
  'grow',
  'defend',
  'harvest',
  'recover'
);

-- ─────────────────────────────────────────────────────────────────────
-- Phase D — remap brand_profiles values to new enum names + restore types
-- ─────────────────────────────────────────────────────────────────────

update public.brand_profiles
set lifecycle_stage = case lifecycle_stage
  when 'Launch'     then 'launch'
  when 'Growth'     then 'growth'
  when 'Maturity'   then 'maturity'
  when 'Transition' then 'recovery'
  when 'Renewal'    then 'recovery'
  else null
end
where lifecycle_stage is not null;

update public.brand_profiles
set intent_state = case intent_state
  when 'Brand_Building'          then 'launch'
  when 'Awareness_Attraction'    then 'grow'
  when 'Differentiation_Loyalty' then 'defend'
  when 'Conversion_Promotional'  then 'harvest'
  when 'Refresh_Relaunch'        then 'recover'
  else null
end
where intent_state is not null;

alter table public.brand_profiles
  alter column lifecycle_stage type lifecycle_stage_type using lifecycle_stage::lifecycle_stage_type,
  alter column intent_state    type intent_state_type    using intent_state::intent_state_type;

-- ─────────────────────────────────────────────────────────────────────
-- Phase E — create the new WIDE-format composition_matrix table
-- ─────────────────────────────────────────────────────────────────────

create table public.composition_matrix (
  matrix_id uuid primary key default gen_random_uuid(),

  archetype       archetype_type        not null,
  lifecycle_stage lifecycle_stage_type  not null,
  intent_state    intent_state_type     not null,

  diagnostic_score    int not null default 0 check (diagnostic_score    between 0 and 100),
  metaphor_score      int not null default 0 check (metaphor_score      between 0 and 100),
  paradox_score       int not null default 0 check (paradox_score       between 0 and 100),
  authenticity_score  int not null default 0 check (authenticity_score  between 0 and 100),
  heritage_score      int not null default 0 check (heritage_score      between 0 and 100),
  vulnerability_score int not null default 0 check (vulnerability_score between 0 and 100),

  recommended_method     creative_method_type,
  is_hybrid_recommended  boolean not null default false,
  hybrid_composition     jsonb,

  created_at timestamptz not null default now(),

  unique (archetype, lifecycle_stage, intent_state)
);

create index idx_composition_matrix_lookup
  on public.composition_matrix (archetype, lifecycle_stage, intent_state);

alter table public.composition_matrix enable row level security;
create policy composition_matrix_public_read on public.composition_matrix
  for select using (true);

-- ─────────────────────────────────────────────────────────────────────
-- Phase F — pivot the captured long-format data into wide rows.
--
-- We pivot 1,800 long rows where (lifecycle, intent) used the OLD enum
-- names into ~240 wide rows whose (lifecycle, intent) match the NEW
-- enum names via the mapping above. After this insert there are 240
-- "data-derived" rows; the remaining 60 tuples that don't have any
-- mapping path (the new pre_launch lifecycle had no old equivalent;
-- the old Transition/Renewal both collapsed to 'recovery' so we keep
-- the higher score) get filled from the heuristic in Phase G below.
-- ─────────────────────────────────────────────────────────────────────

with mapped as (
  select
    archetype::archetype_type as archetype,
    case old_lifecycle
      when 'Launch'     then 'launch'
      when 'Growth'     then 'growth'
      when 'Maturity'   then 'maturity'
      when 'Transition' then 'recovery'
      when 'Renewal'    then 'recovery'
    end::lifecycle_stage_type as lifecycle_stage,
    case old_intent
      when 'Brand_Building'          then 'launch'
      when 'Awareness_Attraction'    then 'grow'
      when 'Differentiation_Loyalty' then 'defend'
      when 'Conversion_Promotional'  then 'harvest'
      when 'Refresh_Relaunch'        then 'recover'
    end::intent_state_type as intent_state,
    method,
    score
  from _matrix_long_old
),
deduped as (
  -- Two old lifecycle values (Transition, Renewal) both collapse to 'recovery'.
  -- For each (archetype × lifecycle × intent × method), keep the MAX score
  -- so we don't lose signal during the merge.
  select
    archetype, lifecycle_stage, intent_state, method,
    max(score) as score
  from mapped
  group by archetype, lifecycle_stage, intent_state, method
),
pivoted as (
  select
    archetype, lifecycle_stage, intent_state,
    coalesce(max(score) filter (where method = 'Diagnostic'),    0) as diagnostic_score,
    coalesce(max(score) filter (where method = 'Metaphor'),      0) as metaphor_score,
    coalesce(max(score) filter (where method = 'Paradox'),       0) as paradox_score,
    coalesce(max(score) filter (where method = 'Authenticity'),  0) as authenticity_score,
    coalesce(max(score) filter (where method = 'Heritage'),      0) as heritage_score,
    coalesce(max(score) filter (where method = 'Vulnerability'), 0) as vulnerability_score
  from deduped
  group by archetype, lifecycle_stage, intent_state
)
insert into public.composition_matrix (
  archetype, lifecycle_stage, intent_state,
  diagnostic_score, metaphor_score, paradox_score,
  authenticity_score, heritage_score, vulnerability_score
)
select
  archetype, lifecycle_stage, intent_state,
  diagnostic_score, metaphor_score, paradox_score,
  authenticity_score, heritage_score, vulnerability_score
from pivoted;

-- ─────────────────────────────────────────────────────────────────────
-- Phase G — fill the missing tuples (pre_launch lifecycle has no old
-- equivalent; pre_launch + 5 intents × 12 archetypes = 60 tuples to add).
-- Use the same heuristic philosophy as 0023 but for pre_launch:
--   • Pre-Launch = "Brand still being built. No followers yet. Voice in
--     calibration mode." Per doc, "Diagnostic upstream only" is the best fit.
--   • So Diagnostic should score high; Vulnerability moderate; everything
--     else low (no audience yet to engage).
-- ─────────────────────────────────────────────────────────────────────

insert into public.composition_matrix (
  archetype, lifecycle_stage, intent_state,
  diagnostic_score, metaphor_score, paradox_score,
  authenticity_score, heritage_score, vulnerability_score
)
select
  a.archetype,
  'pre_launch'::lifecycle_stage_type,
  i.intent,
  -- Diagnostic — pre_launch's documented best fit (upstream)
  case
    when i.intent = 'launch' then 80
    when i.intent = 'grow'   then 70
    else 65
  end as diagnostic_score,
  -- Metaphor — too poetic for pre-launch
  20 as metaphor_score,
  -- Paradox — only useful when there's an audience to provoke
  case when a.archetype in ('Magician','Outlaw','Hero') then 50 else 30 end as paradox_score,
  -- Authenticity — strong baseline even pre-launch
  case
    when a.archetype in ('Caregiver','Everyman','Innocent') then 70
    when a.archetype in ('Sage','Ruler','Creator') then 65
    else 60
  end as authenticity_score,
  -- Heritage — no heritage to claim yet
  20 as heritage_score,
  -- Vulnerability — building-in-public is exactly pre_launch's strength
  case
    when a.archetype in ('Caregiver','Everyman','Hero','Innocent') then 75
    when a.archetype in ('Lover','Jester','Explorer') then 60
    else 55
  end as vulnerability_score
from
  unnest(enum_range(null::archetype_type)) as a(archetype)
  cross join unnest(enum_range(null::intent_state_type)) as i(intent)
on conflict (archetype, lifecycle_stage, intent_state) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- Phase H — fill any remaining tuple gaps (some old (archetype × stage
-- × intent) combos may not have existed in the old long-format if the old
-- enum had different intent names). For any of the 300 tuples still missing,
-- fall back to the heuristic Authenticity-leaning baseline.
-- ─────────────────────────────────────────────────────────────────────

insert into public.composition_matrix (
  archetype, lifecycle_stage, intent_state,
  diagnostic_score, metaphor_score, paradox_score,
  authenticity_score, heritage_score, vulnerability_score
)
select
  a.archetype, l.lifecycle, i.intent,
  -- Diagnostic
  case
    when l.lifecycle = 'launch'   then 50
    when l.lifecycle = 'maturity' then 65
    when i.intent = 'harvest'     then 70
    else 55
  end,
  -- Metaphor
  case
    when a.archetype in ('Lover','Creator','Magician','Jester') then 60
    when a.archetype in ('Ruler','Sage') then 25
    else 40
  end,
  -- Paradox
  case
    when a.archetype in ('Magician','Outlaw','Hero') then 75
    when l.lifecycle = 'recovery' then 65
    else 50
  end,
  -- Authenticity (universal default)
  case
    when l.lifecycle = 'launch'    then 75
    when l.lifecycle = 'recovery'  then 78
    when l.lifecycle = 'maturity' and a.archetype in ('Sage','Ruler','Creator') then 80
    else 70
  end,
  -- Heritage
  case
    when l.lifecycle = 'maturity' and a.archetype in ('Sage','Ruler','Creator') then 80
    when l.lifecycle = 'maturity' then 60
    when l.lifecycle = 'launch'   then 25
    else 45
  end,
  -- Vulnerability
  case
    when l.lifecycle = 'launch' and a.archetype in ('Caregiver','Everyman','Hero','Innocent') then 80
    when l.lifecycle = 'recovery' then 75
    when i.intent = 'recover'     then 75
    when l.lifecycle = 'maturity' and a.archetype in ('Sage','Ruler') then 25
    else 50
  end
from
  unnest(enum_range(null::archetype_type)) as a(archetype)
  cross join unnest(enum_range(null::lifecycle_stage_type)) as l(lifecycle)
  cross join unnest(enum_range(null::intent_state_type)) as i(intent)
on conflict (archetype, lifecycle_stage, intent_state) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- Phase I — populate recommended_method, is_hybrid_recommended, hybrid_composition
-- ─────────────────────────────────────────────────────────────────────

update public.composition_matrix m
set
  recommended_method = (case
    when greatest(m.diagnostic_score, m.metaphor_score, m.paradox_score,
                  m.authenticity_score, m.heritage_score, m.vulnerability_score) >= 80
    then (case greatest(m.diagnostic_score, m.metaphor_score, m.paradox_score,
                        m.authenticity_score, m.heritage_score, m.vulnerability_score)
            when m.diagnostic_score    then 'Diagnostic'
            when m.metaphor_score      then 'Metaphor'
            when m.paradox_score       then 'Paradox'
            when m.authenticity_score  then 'Authenticity'
            when m.heritage_score      then 'Heritage'
            when m.vulnerability_score then 'Vulnerability'
          end)::creative_method_type
    else null
  end),
  is_hybrid_recommended = (
    greatest(m.diagnostic_score, m.metaphor_score, m.paradox_score,
             m.authenticity_score, m.heritage_score, m.vulnerability_score) < 80
  ),
  hybrid_composition = (case
    when greatest(m.diagnostic_score, m.metaphor_score, m.paradox_score,
                  m.authenticity_score, m.heritage_score, m.vulnerability_score) < 80
    then (
      with scored as (
        select * from (values
          ('Diagnostic',    m.diagnostic_score),
          ('Metaphor',      m.metaphor_score),
          ('Paradox',       m.paradox_score),
          ('Authenticity',  m.authenticity_score),
          ('Heritage',      m.heritage_score),
          ('Vulnerability', m.vulnerability_score)
        ) as v(method, score)
        order by score desc
        limit 3
      )
      select jsonb_build_object(
        'top_3',
        jsonb_agg(jsonb_build_object('method', method, 'score', score))
      ) from scored
    )
    else null
  end);

-- ─────────────────────────────────────────────────────────────────────
-- Phase J — verify final state
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  total int;
  expected int := 12 * 5 * 5;
  single_count int;
  hybrid_count int;
begin
  select count(*) into total from public.composition_matrix;
  if total <> expected then
    raise exception 'composition_matrix has % rows, expected % (300 tuples)', total, expected;
  end if;

  select count(*) into single_count from public.composition_matrix where is_hybrid_recommended = false;
  select count(*) into hybrid_count from public.composition_matrix where is_hybrid_recommended = true;

  raise notice 'composition_matrix: % rows total (% single-method recommendations, % hybrids)',
    total, single_count, hybrid_count;
end $$;

commit;
