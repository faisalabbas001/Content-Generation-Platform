-- Migration 0020 — BrandDNA v2 (Three-Axis Creative Direction Framework)
--
-- Adds the creative-direction layer that sits on top of the existing 10-field
-- BrandDNA Lite identity. After this migration:
--
--   • brand_profiles gains 4 axis fields (archetype, lifecycle_stage, intent_state)
--   • brand_method_profiles holds the composed creative direction per brand
--   • brand_method_profile_history is an append-only audit of every change
--   • composition_matrix holds scoring weights for archetype × stage × intent → method
--   • creative_methods is a 6-row reference table for the methods themselves
--
-- Hard Rule #2: every new BrandDNA-bearing column is written EXCLUSIVELY by
-- the Memory Controller via memory_controller_queue. This migration only
-- creates the storage; the appliers in packages/memory are extended in a
-- separate change. The nomination_type_enum gets a new value here.
--
-- Idempotent: safe to re-run.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Enums for the new axis fields
-- ─────────────────────────────────────────────────────────────────────

do $$ begin
  create type archetype_type as enum (
    'Innocent', 'Sage', 'Explorer', 'Outlaw',
    'Magician', 'Hero', 'Lover', 'Jester',
    'Everyman', 'Caregiver', 'Ruler', 'Creator'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lifecycle_stage_type as enum (
    'Launch', 'Growth', 'Maturity', 'Transition', 'Renewal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type intent_state_type as enum (
    'Brand_Building',
    'Awareness_Attraction',
    'Differentiation_Loyalty',
    'Conversion_Promotional',
    'Refresh_Relaunch'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Method-anatomy enums (the 5 composable components)
-- ─────────────────────────────────────────────────────────────────────
-- Closed enums keep COO's output validatable. If a pattern is added later,
-- it requires a new migration — that's deliberate; pattern lists should be
-- stable for at least a quarter at a time.

do $$ begin
  create type voice_register_type as enum (
    'intimate_humble',
    'authoritative_warm',
    'ironic_observer',
    'devotional_serene',
    'playful_curious',
    'crafted_precise'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type diagnostic_pattern_type as enum (
    'story_opener',
    'question_opener',
    'claim_opener',
    'contradiction_opener',
    'observation_opener'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type visual_idiom_type as enum (
    'minimal_natural_light',
    'archive_film_grain',
    'flat_graphic_warm',
    'editorial_dramatic',
    'documentary_unposed',
    'studio_polished'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cadence_rule_type as enum (
    'steady_drumbeat',
    'burst_then_quiet',
    'narrative_arc',
    'occasion_aligned',
    'reactive_responsive'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type closing_pattern_type as enum (
    'soft_invitation',
    'direct_ask',
    'open_question',
    'no_close',
    'community_call'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type creative_method_type as enum (
    'Authenticity',
    'Heritage',
    'Metaphor',
    'Paradox',
    'Diagnostic',
    'Vulnerability'
  );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. brand_profiles — add the 4 axis columns
-- ─────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists archetype_primary    archetype_type,
  add column if not exists archetype_secondary  archetype_type,
  add column if not exists lifecycle_stage      lifecycle_stage_type,
  add column if not exists intent_state         intent_state_type;

-- Sanity constraint — secondary cannot equal primary (or be set without primary)
alter table public.brand_profiles
  drop constraint if exists brand_profiles_archetype_distinct_chk;
alter table public.brand_profiles
  add constraint brand_profiles_archetype_distinct_chk
  check (
    archetype_secondary is null
    or (archetype_primary is not null and archetype_secondary <> archetype_primary)
  );

-- Indexes for admin queries (count by archetype, count by stage)
create index if not exists idx_brand_profiles_archetype
  on public.brand_profiles (archetype_primary)
  where archetype_primary is not null;
create index if not exists idx_brand_profiles_lifecycle
  on public.brand_profiles (lifecycle_stage)
  where lifecycle_stage is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 4. brand_method_profiles — per-brand composed creative direction
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.brand_method_profiles (
  brand_id                uuid primary key references public.brand_profiles(brand_id) on delete cascade,
  voice_register          voice_register_type      not null,
  diagnostic_pattern      diagnostic_pattern_type  not null,
  visual_idiom            visual_idiom_type        not null,
  cadence_rule            cadence_rule_type        not null,
  closing_pattern         closing_pattern_type     not null,
  -- composition_blend records which method each component was sourced from.
  -- e.g. { "voice": "Authenticity", "diagnostic": "Paradox", ... }
  composition_blend       jsonb                    not null default '{}'::jsonb,
  composition_score       int                      not null default 50
                          check (composition_score between 0 and 100),
  creative_direction_text text                     not null default ''
                          check (char_length(creative_direction_text) <= 4000),
  updated_at              timestamptz              not null default now(),
  created_at              timestamptz              not null default now()
);

alter table public.brand_method_profiles enable row level security;

-- Owner-read for the brand's user
drop policy if exists method_profile_owner_read on public.brand_method_profiles;
create policy method_profile_owner_read on public.brand_method_profiles
  for select
  using (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = brand_method_profiles.brand_id
        and bp.auth_user_id = auth.uid()
    )
  );

-- Memory Controller (service_role) writes only — no client write policy

-- ─────────────────────────────────────────────────────────────────────
-- 5. brand_method_profile_history — append-only audit
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.brand_method_profile_history (
  history_id        uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brand_profiles(brand_id) on delete cascade,
  changed_at        timestamptz not null default now(),
  -- Snapshot of the new state (the row that was just written).
  voice_register          voice_register_type     not null,
  diagnostic_pattern      diagnostic_pattern_type not null,
  visual_idiom            visual_idiom_type       not null,
  cadence_rule            cadence_rule_type       not null,
  closing_pattern         closing_pattern_type    not null,
  composition_blend       jsonb                   not null default '{}'::jsonb,
  composition_score       int                     not null default 50,
  creative_direction_text text                    not null default '',
  -- What triggered the change.
  change_reason     text not null default 'unknown', -- 'onboarding' | 'correction' | 'maintenance' | 'manual'
  changed_by        text                                  -- agent name or user id
);

create index if not exists idx_method_profile_history_brand
  on public.brand_method_profile_history (brand_id, changed_at desc);

alter table public.brand_method_profile_history enable row level security;

-- Owner-read
drop policy if exists method_history_owner_read on public.brand_method_profile_history;
create policy method_history_owner_read on public.brand_method_profile_history
  for select
  using (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = brand_method_profile_history.brand_id
        and bp.auth_user_id = auth.uid()
    )
  );

-- Append-only: no UPDATE, no DELETE
drop policy if exists method_history_no_update on public.brand_method_profile_history;
create policy method_history_no_update on public.brand_method_profile_history
  for update using (false);

drop policy if exists method_history_no_delete on public.brand_method_profile_history;
create policy method_history_no_delete on public.brand_method_profile_history
  for delete using (false);

-- ─────────────────────────────────────────────────────────────────────
-- 6. creative_methods — 6-row reference for the methods
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.creative_methods (
  method            creative_method_type primary key,
  description       text not null,
  coverage_pct      int not null default 0
                    check (coverage_pct between 0 and 100),
  archetypes_served archetype_type[] not null default '{}',
  novel_pattern     text  -- one-line description of what the method brings
);

-- Public-read; only DB owner writes (seeded data, rarely changes)
alter table public.creative_methods enable row level security;
drop policy if exists creative_methods_public_read on public.creative_methods;
create policy creative_methods_public_read on public.creative_methods
  for select using (true);

-- Seed the 6 methods (idempotent via upsert)
insert into public.creative_methods (method, description, coverage_pct, archetypes_served, novel_pattern)
values
  ('Authenticity',
   'Direct, unembellished brand voice grounded in shared values. The default for trust-led SME content.',
   50,
   array['Caregiver','Everyman','Sage','Innocent']::archetype_type[],
   'Plain-spoken first-person voice; no metaphor scaffolding.'),
  ('Heritage',
   'Lineage and craft cues. Brings legitimacy through history, place, and material.',
   25,
   array['Sage','Ruler','Creator']::archetype_type[],
   'Archive imagery and inheritance language; founder/family narration.'),
  ('Metaphor',
   'Concept compression through analogy. Best for abstract or institutional brands.',
   20,
   array['Creator','Magician','Sage']::archetype_type[],
   'Single-image, single-sentence metaphors; product-as-something-else.'),
  ('Paradox',
   'Build-and-flip structure that surfaces tension. High-engagement on differentiation posts.',
   30,
   array['Magician','Hero','Outlaw','Lover']::archetype_type[],
   'Setup-then-subvert opening; named contradiction in copy.'),
  ('Diagnostic',
   'Strips a brief to its cultural contract. Used as upstream for any brand at Launch stage.',
   25,
   array[]::archetype_type[],
   'Outputs a positioning sentence other methods then execute against.'),
  ('Vulnerability',
   'Permission-to-be-imperfect voice. The system-default for Launch-stage SMEs and the composition fallback when no method scores above 80.',
   20,
   array['Caregiver','Everyman','Hero','Innocent']::archetype_type[],
   'Admit limitations explicitly; lead with what the brand is still learning.')
on conflict (method) do update
  set description       = excluded.description,
      coverage_pct      = excluded.coverage_pct,
      archetypes_served = excluded.archetypes_served,
      novel_pattern     = excluded.novel_pattern;

-- ─────────────────────────────────────────────────────────────────────
-- 7. composition_matrix — scoring weights per (archetype × stage × intent) → method
-- ─────────────────────────────────────────────────────────────────────
-- Row count: up to 12 × 5 × 5 × 6 = 1800 rows (sparse — only seeded rows
-- exist; missing combinations fall back to a JS formula in @repo/core).
-- We seed the 14 most-common Saudi-SME configs (per framework v2) plus a
-- handful of common edge cases. Ops can add rows for new configs without
-- a migration via direct INSERT (or via an admin tool later).

create table if not exists public.composition_matrix (
  archetype       archetype_type        not null,
  lifecycle_stage lifecycle_stage_type  not null,
  intent_state    intent_state_type     not null,
  method          creative_method_type  not null,
  score           int                   not null check (score between 0 and 100),
  notes           text,
  primary key (archetype, lifecycle_stage, intent_state, method)
);

alter table public.composition_matrix enable row level security;
drop policy if exists composition_matrix_public_read on public.composition_matrix;
create policy composition_matrix_public_read on public.composition_matrix
  for select using (true);

-- Seed the 14 documented common Saudi-SME configs
-- (framework §"The Composition Matrix")
insert into public.composition_matrix (archetype, lifecycle_stage, intent_state, method, score)
values
  -- Caregiver × Launch × Brand-Building
  ('Caregiver','Launch','Brand_Building','Diagnostic',50),
  ('Caregiver','Launch','Brand_Building','Metaphor',20),
  ('Caregiver','Launch','Brand_Building','Paradox',45),
  ('Caregiver','Launch','Brand_Building','Authenticity',78),
  ('Caregiver','Launch','Brand_Building','Heritage',30),
  ('Caregiver','Launch','Brand_Building','Vulnerability',85),

  -- Sage × Maturity × Differentiation-Loyalty
  ('Sage','Maturity','Differentiation_Loyalty','Diagnostic',65),
  ('Sage','Maturity','Differentiation_Loyalty','Metaphor',25),
  ('Sage','Maturity','Differentiation_Loyalty','Paradox',45),
  ('Sage','Maturity','Differentiation_Loyalty','Authenticity',85),
  ('Sage','Maturity','Differentiation_Loyalty','Heritage',75),
  ('Sage','Maturity','Differentiation_Loyalty','Vulnerability',50),

  -- Everyman × Growth × Awareness-Attraction
  ('Everyman','Growth','Awareness_Attraction','Diagnostic',65),
  ('Everyman','Growth','Awareness_Attraction','Metaphor',35),
  ('Everyman','Growth','Awareness_Attraction','Paradox',60),
  ('Everyman','Growth','Awareness_Attraction','Authenticity',78),
  ('Everyman','Growth','Awareness_Attraction','Heritage',35),
  ('Everyman','Growth','Awareness_Attraction','Vulnerability',75),

  -- Magician × Growth × Differentiation-Loyalty
  ('Magician','Growth','Differentiation_Loyalty','Diagnostic',60),
  ('Magician','Growth','Differentiation_Loyalty','Metaphor',68),
  ('Magician','Growth','Differentiation_Loyalty','Paradox',85),
  ('Magician','Growth','Differentiation_Loyalty','Authenticity',50),
  ('Magician','Growth','Differentiation_Loyalty','Heritage',40),
  ('Magician','Growth','Differentiation_Loyalty','Vulnerability',25),

  -- Lover × Maturity × Conversion-Promotional
  ('Lover','Maturity','Conversion_Promotional','Diagnostic',35),
  ('Lover','Maturity','Conversion_Promotional','Metaphor',68),
  ('Lover','Maturity','Conversion_Promotional','Paradox',75),
  ('Lover','Maturity','Conversion_Promotional','Authenticity',65),
  ('Lover','Maturity','Conversion_Promotional','Heritage',50),
  ('Lover','Maturity','Conversion_Promotional','Vulnerability',55),

  -- Caregiver × Growth × Differentiation-Loyalty
  ('Caregiver','Growth','Differentiation_Loyalty','Diagnostic',60),
  ('Caregiver','Growth','Differentiation_Loyalty','Metaphor',25),
  ('Caregiver','Growth','Differentiation_Loyalty','Paradox',50),
  ('Caregiver','Growth','Differentiation_Loyalty','Authenticity',85),
  ('Caregiver','Growth','Differentiation_Loyalty','Heritage',45),
  ('Caregiver','Growth','Differentiation_Loyalty','Vulnerability',75),

  -- Hero × Launch × Brand-Building
  ('Hero','Launch','Brand_Building','Diagnostic',55),
  ('Hero','Launch','Brand_Building','Metaphor',30),
  ('Hero','Launch','Brand_Building','Paradox',82),
  ('Hero','Launch','Brand_Building','Authenticity',40),
  ('Hero','Launch','Brand_Building','Heritage',25),
  ('Hero','Launch','Brand_Building','Vulnerability',75),

  -- Ruler × Maturity × Differentiation-Loyalty
  ('Ruler','Maturity','Differentiation_Loyalty','Diagnostic',65),
  ('Ruler','Maturity','Differentiation_Loyalty','Metaphor',60),
  ('Ruler','Maturity','Differentiation_Loyalty','Paradox',45),
  ('Ruler','Maturity','Differentiation_Loyalty','Authenticity',75),
  ('Ruler','Maturity','Differentiation_Loyalty','Heritage',85),
  ('Ruler','Maturity','Differentiation_Loyalty','Vulnerability',30)
on conflict (archetype, lifecycle_stage, intent_state, method) do update
  set score = excluded.score;

create index if not exists idx_composition_matrix_lookup
  on public.composition_matrix (archetype, lifecycle_stage, intent_state);

-- ─────────────────────────────────────────────────────────────────────
-- 8. memory_controller_queue — extend nomination_type_enum
-- ─────────────────────────────────────────────────────────────────────

do $$ begin
  alter type nomination_type_enum add value if not exists 'method_profile_update';
exception when duplicate_object then null; end $$;

commit;
