-- Migration 0043 — BrandDNA Layer 2 (Owner Profile) + Layer 4 (Strategy) columns
--
-- Layer 2 adds the owner persona fields missing from the original schema.
-- Layer 4 adds the full strategy layer: permission level, cultural tension,
-- creative formulas, content mix, goal phase, occasion approach, business events.
--
-- All columns are nullable — existing brands are not broken by this migration.
-- Idempotent — safe to re-run (uses ADD COLUMN IF NOT EXISTS).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS (Layer 2 + Layer 4)
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  create type comfort_on_camera_type as enum ('willing', 'hesitant', 'not_interested');
exception when duplicate_object then null; end $$;

do $$ begin
  create type way_of_speaking_type as enum ('formal', 'casual', 'storytelling', 'direct');
exception when duplicate_object then null; end $$;

do $$ begin
  create type permission_level_type as enum (
    'category_leader',
    'challenger',
    'institutional',
    'purpose',
    'launch',
    'sme_local'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_phase_type as enum ('awareness', 'conversion', 'retention', 'launch');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_profiles — Layer 2: Owner Profile additions
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists founding_story           text          null,
  add column if not exists comfort_on_camera        comfort_on_camera_type null,
  add column if not exists physical_appearance_notes text         null,
  add column if not exists way_of_speaking          way_of_speaking_type   null,
  add column if not exists content_preferences      jsonb         null default '[]'::jsonb;

comment on column public.brand_profiles.founding_story            is 'Layer 2: Origin and motivation captured during onboarding chat.';
comment on column public.brand_profiles.comfort_on_camera         is 'Layer 2: Owner comfort appearing in content (willing/hesitant/not_interested).';
comment on column public.brand_profiles.physical_appearance_notes is 'Layer 2: Appearance notes for content direction — populated from uploaded assets.';
comment on column public.brand_profiles.way_of_speaking           is 'Layer 2: Communication style (formal/casual/storytelling/direct).';
comment on column public.brand_profiles.content_preferences       is 'Layer 2: JSONB array of content types the owner personally connects with.';

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_profiles — Layer 4: Strategic Intelligence additions
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists permission_level         permission_level_type  null,
  add column if not exists cultural_tension_owned   text          null,
  add column if not exists creative_formulas_approved text[]       null default '{}',
  add column if not exists brave_safe_default       boolean       null default false,
  add column if not exists strategy_version         integer       null default 0,
  add column if not exists content_mix_ratios       jsonb         null default '{}'::jsonb,
  add column if not exists platform_weights         jsonb         null default '{}'::jsonb,
  add column if not exists goal_phase               goal_phase_type        null,
  add column if not exists occasion_approach        jsonb         null default '{}'::jsonb,
  add column if not exists business_events          jsonb         null default '[]'::jsonb;

comment on column public.brand_profiles.permission_level          is 'Layer 4: Strategic authority level — determines which creative approaches are available.';
comment on column public.brand_profiles.cultural_tension_owned    is 'Layer 4: The specific cultural tension this brand has claimed (registered per sector+city+competitor group).';
comment on column public.brand_profiles.creative_formulas_approved is 'Layer 4: Array of approved creative formula keys from the 7-formula system.';
comment on column public.brand_profiles.brave_safe_default        is 'Layer 4: Risk tolerance — true means brave route is preferred by default.';
comment on column public.brand_profiles.strategy_version          is 'Layer 4: Increments every time the strategy meaningfully updates. Clients receive notification on each increment.';
comment on column public.brand_profiles.content_mix_ratios        is 'Layer 4: JSONB map of content type to percentage — e.g. {"product":30,"lifestyle":25,"occasion":20}.';
comment on column public.brand_profiles.platform_weights          is 'Layer 4: JSONB map of platform to weight percentage — e.g. {"Instagram":60,"TikTok":40}.';
comment on column public.brand_profiles.goal_phase                is 'Layer 4: Current brand goal phase (awareness/conversion/retention/launch).';
comment on column public.brand_profiles.occasion_approach         is 'Layer 4: JSONB map of occasion_key to approach (full/reduced/none) — e.g. {"ramadan":"full","national_day":"reduced"}.';
comment on column public.brand_profiles.business_events           is 'Layer 4: JSONB array of upcoming events — e.g. [{"type":"launch","date":"2026-07-01","description":"New branch opening"}].';

-- ─────────────────────────────────────────────────────────────────────────────
-- strategy_updates_log — Layer 4: track what changed and why (client notified)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.strategy_updates_log (
  log_id            uuid          primary key default gen_random_uuid(),
  brand_id          uuid          not null references public.brand_profiles(brand_id) on delete cascade,
  strategy_version  integer       not null,
  changed_fields    text[]        not null default '{}',
  change_summary    text          null,
  trigger_type      text          null, -- 'performance_signal' | 'client_correction' | 'competitor_alert' | 'manual'
  triggered_by      text          null, -- agent name or user_id
  client_notified   boolean       not null default false,
  created_at        timestamptz   not null default now()
);

comment on table public.strategy_updates_log is 'Layer 4: Append-only log of strategy changes. client_notified tracks whether notification was sent.';

create index if not exists idx_strategy_updates_log_brand
  on public.strategy_updates_log(brand_id, created_at desc);

-- RLS: same pattern as branddna_event_log — append-only, service role writes
alter table public.strategy_updates_log enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='strategy_updates_log' and policyname='service_role full access') then
    create policy "service_role full access" on public.strategy_updates_log
      for all to service_role using (true) with check (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='strategy_updates_log' and policyname='brand owner read own') then
    create policy "brand owner read own" on public.strategy_updates_log
      for select to authenticated
      using (
        brand_id in (
          select brand_id from public.brand_profiles where auth_user_id = auth.uid()
        )
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- business_events table — separate from JSONB column for queryability
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.business_events (
  event_id        uuid          primary key default gen_random_uuid(),
  brand_id        uuid          not null references public.brand_profiles(brand_id) on delete cascade,
  event_type      text          not null, -- 'launch' | 'promotion' | 'opening' | 'campaign' | 'other'
  title           text          not null,
  description     text          null,
  event_date      date          null,
  end_date        date          null,
  is_active       boolean       not null default true,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

comment on table public.business_events is 'Layer 4: Upcoming brand events that anchor the content calendar — launches, promotions, openings.';

create index if not exists idx_business_events_brand_date
  on public.business_events(brand_id, event_date asc);

alter table public.business_events enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='business_events' and policyname='service_role full access') then
    create policy "service_role full access" on public.business_events
      for all to service_role using (true) with check (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='business_events' and policyname='brand owner manage own') then
    create policy "brand owner manage own" on public.business_events
      for all to authenticated
      using (
        brand_id in (
          select brand_id from public.brand_profiles where auth_user_id = auth.uid()
        )
      )
      with check (
        brand_id in (
          select brand_id from public.brand_profiles where auth_user_id = auth.uid()
        )
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- cultural_tension_registry — prevents two competing brands from owning the
-- same tension in the same sector+city+competitor group (Doc §creative uniqueness)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.cultural_tension_registry (
  registry_id     uuid          primary key default gen_random_uuid(),
  brand_id        uuid          not null references public.brand_profiles(brand_id) on delete cascade,
  tension_text    text          not null,
  sector          text          not null,
  city_primary    text          null,
  claimed_at      timestamptz   not null default now(),
  released_at     timestamptz   null, -- set when brand loses protection (90-day no-use rule)
  is_active       boolean       not null default true,
  unique (brand_id, tension_text)
);

comment on table public.cultural_tension_registry is 'Layer 4: Registry of claimed cultural tensions per sector/city. Prevents competitive overlap. Released after 90 days of no aligned content.';

create index if not exists idx_tension_registry_sector_city
  on public.cultural_tension_registry(sector, city_primary, is_active);

alter table public.cultural_tension_registry enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='cultural_tension_registry' and policyname='service_role full access') then
    create policy "service_role full access" on public.cultural_tension_registry
      for all to service_role using (true) with check (true);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: enable new tables
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.business_events;
alter publication supabase_realtime add table public.strategy_updates_log;

commit;
