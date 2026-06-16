-- OpenClaw — 0001_init
-- Doc §4 (BrandDNA schema) + §7 (RLS + indexes)
-- Idempotent: safe to re-run. All RLS enforced. Append-only tables block UPDATE/DELETE.

begin;

-- ─────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────
do $$ begin
  create type sector_type as enum ('F&B','Retail','Beauty_Wellness','Healthcare','Finance','Government','Other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dialect_type as enum ('Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type price_position_type as enum ('budget','mid_market','premium','luxury');
exception when duplicate_object then null; end $$;

do $$ begin
  create type formality_type as enum ('casual','semi_formal','formal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type humor_tolerance_type as enum ('none','light','moderate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type religious_sensitivity_type as enum ('Low','Medium','High');
exception when duplicate_object then null; end $$;

do $$ begin
  create type bilingual_ratio_type as enum ('arabic_only','arabic_primary','balanced','english_primary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type relevance_type as enum ('Critical','High','Medium','Low','Not_relevant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_type as enum ('Instagram','Snapchat','TikTok','Twitter');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tier_type as enum ('free','paid_starter','paid_pro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pipeline_tier_type as enum ('Starter','Pro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type field_confidence_type as enum (
    'explicitly_confirmed','inferred_high','inferred_medium','inferred_low','rejected','deprecated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type confidence_mode_type as enum ('Standard','Cautious','Minimal','Blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nomination_type_enum as enum (
    'field_update','confidence_upgrade','negative_pattern_add',
    'override_rule_add','sector_signal','global_signal'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type nomination_status_type as enum ('pending','validated','written','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_type_enum as enum (
    'source_ingested','contradiction_detected','client_confirmed',
    'override_added','confidence_upgraded','brand_graduated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type qa_status_type as enum ('pending','approved','rejected','edited');
exception when duplicate_object then null; end $$;

do $$ begin
  create type negpat_severity_type as enum ('SOFT_WARN','STRONG_WARN','HARD_BLOCK');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_type_enum as enum ('form','correction','scrape','instagram','website','google_places');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────
-- 2. LAYER 2 — Sector Intelligence (created first — FK target)
-- ─────────────────────────────────────────────────────────
create table if not exists public.sector_baselines (
  baseline_id              uuid primary key default gen_random_uuid(),
  sector                   sector_type   not null,
  dialect                  dialect_type  not null,
  last_updated             timestamptz   not null default now(),
  sample_size              int           not null default 0,
  recommended_content_mix  jsonb         not null default '{}'::jsonb,
  top_performing_tones     jsonb         not null default '[]'::jsonb,
  worst_performing_tones   jsonb         not null default '[]'::jsonb,
  occasion_insights        jsonb         not null default '{}'::jsonb,
  common_negative_patterns jsonb         not null default '[]'::jsonb,
  confidence_benchmarks    jsonb         not null default '{}'::jsonb,
  unique (sector, dialect)
);

create table if not exists public.sector_question_weights (
  weight_id      uuid primary key default gen_random_uuid(),
  sector         sector_type not null,
  question_key   text        not null,
  weight         float       not null default 1.0,
  last_updated   timestamptz not null default now(),
  unique (sector, question_key)
);

create table if not exists public.sector_trends (
  trend_id      uuid primary key default gen_random_uuid(),
  sector        sector_type not null,
  dialect       dialect_type,
  trend_key     text        not null,
  signal        jsonb       not null default '{}'::jsonb,
  observed_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 3. LAYER 1 — Private Brand tables
-- ─────────────────────────────────────────────────────────
create table if not exists public.brand_profiles (
  brand_id                  uuid primary key default gen_random_uuid(),
  brand_name_ar             text not null,
  brand_name_en             text,
  sector                    sector_type not null,
  city_primary              text,
  arabic_dialect            dialect_type,
  price_position            price_position_type,
  brand_differentiator      text,
  formality_level           formality_type,
  humor_tolerance           humor_tolerance_type,
  religious_sensitivity     religious_sensitivity_type,
  bilingual_ratio           bilingual_ratio_type,
  ramadan_relevance         relevance_type,
  eid_fitr_relevance        relevance_type,
  eid_adha_relevance        relevance_type,
  national_day_relevance    relevance_type,
  founding_day_relevance    relevance_type,
  primary_channel           channel_type,
  tier                      tier_type not null default 'free',
  pipeline_tier             pipeline_tier_type not null default 'Starter',
  batch_shard               int not null default 0 check (batch_shard between 0 and 6),
  sector_baseline_id        uuid references public.sector_baselines(baseline_id) on delete set null,
  client_slug               text unique not null,
  logo_url                  text,
  primary_color_hex         char(7) check (primary_color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  completeness_score        float not null default 0 check (completeness_score between 0 and 100),
  total_calendars_generated int not null default 0,
  auth_user_id              uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.audience_profiles (
  audience_id       uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brand_profiles(brand_id) on delete cascade,
  description_ar    text,
  gender_mix        jsonb,
  age_range         jsonb,
  language_preference bilingual_ratio_type,
  created_at        timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists public.visual_style_profiles (
  style_id          uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brand_profiles(brand_id) on delete cascade,
  style_descriptor  text,
  color_palette     text[],
  platform_specs    jsonb,
  created_at        timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists public.channel_profiles (
  channel_id        uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brand_profiles(brand_id) on delete cascade,
  channel           channel_type not null,
  handle            text,
  followers         int,
  engagement_rate   float,
  last_scraped_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (brand_id, channel)
);

create table if not exists public.source_records (
  source_id       uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  source_type     source_type_enum not null,
  raw_payload     jsonb not null default '{}'::jsonb,
  recency_score   float not null default 1.0 check (recency_score between 0 and 1),
  captured_at     timestamptz not null default now()
);

create table if not exists public.evidence_bundles (
  bundle_id                uuid primary key default gen_random_uuid(),
  brand_id                 uuid not null references public.brand_profiles(brand_id) on delete cascade,
  field_name               text not null,
  supporting_source_ids    uuid[] not null default '{}',
  contradicting_source_ids uuid[] not null default '{}',
  agreement_ratio          float not null default 0 check (agreement_ratio between 0 and 1),
  recency_score            float not null default 0 check (recency_score between 0 and 1),
  conflict_score           float not null default 0 check (conflict_score between 0 and 1),
  field_confidence         field_confidence_type not null default 'inferred_low',
  last_evaluated           timestamptz not null default now(),
  unique (brand_id, field_name)
);

create table if not exists public.negative_patterns (
  pattern_id    uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brand_profiles(brand_id) on delete cascade,
  pattern_text  text not null,
  severity      negpat_severity_type not null default 'SOFT_WARN',
  created_at    timestamptz not null default now()
);

create table if not exists public.override_rules (
  rule_id       uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brand_profiles(brand_id) on delete cascade,
  rule_key      text not null,
  rule_value    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.onboarding_questions (
  question_id         uuid primary key default gen_random_uuid(),
  question_text_ar    text not null,
  question_text_en    text,
  maps_to_field       text not null,
  sector_relevance    jsonb not null default '{}'::jsonb,
  importance_score    float not null default 1.0,
  introduced_at       timestamptz not null default now(),
  introduced_because  text
);

create table if not exists public.onboarding_responses (
  response_id         uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brand_profiles(brand_id) on delete cascade,
  question_id         uuid not null references public.onboarding_questions(question_id) on delete restrict,
  answer_raw          text,
  answer_processed    jsonb,
  confidence_weight   float not null default 1.0,
  source              source_type_enum not null default 'form',
  answered_at         timestamptz not null default now()
);

create table if not exists public.brand_performance_log (
  perf_id         uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  post_id         uuid,
  metric_key      text not null,
  metric_value    float,
  captured_at     timestamptz not null default now()
);

create table if not exists public.brand_snapshots (
  snapshot_id     uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  is_partial      boolean not null default false,
  snapshot_data   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 4. LAYER 3 — Global anonymous tables (zero FK to brand_profiles)
-- ─────────────────────────────────────────────────────────
create table if not exists public.content_performance_patterns (
  pattern_id       uuid primary key default gen_random_uuid(),
  sector           sector_type not null,
  dialect          dialect_type,
  occasion         text,
  content_type     text,
  objective        text,
  avg_confidence   float,
  approval_rate    float,
  revision_rate    float,
  hard_block_rate  float,
  sample_size      int not null default 0,
  last_updated     timestamptz not null default now()
);

create table if not exists public.negative_pattern_library (
  entry_id       uuid primary key default gen_random_uuid(),
  pattern_text   text not null,
  severity       negpat_severity_type not null default 'SOFT_WARN',
  sectors        sector_type[] not null default '{}',
  description    text
);

create table if not exists public.onboarding_intelligence (
  intel_id       uuid primary key default gen_random_uuid(),
  question_key   text not null,
  sector         sector_type,
  answer_pattern jsonb not null default '{}'::jsonb,
  outcome_signal jsonb not null default '{}'::jsonb,
  sample_size    int not null default 0,
  last_updated   timestamptz not null default now()
);

create table if not exists public.visual_performance_global (
  visual_id      uuid primary key default gen_random_uuid(),
  sector         sector_type not null,
  style_key      text not null,
  approval_rate  float,
  sample_size    int not null default 0,
  last_updated   timestamptz not null default now()
);

create table if not exists public.occasion_intelligence (
  occasion_id       uuid primary key default gen_random_uuid(),
  occasion_key      text not null,            -- e.g. 'ramadan','eid_fitr','national_day'
  occasion_name_ar  text not null,
  occasion_name_en  text,
  year              int not null,
  gregorian_date    date not null,
  lead_weeks        int not null default 2,
  priority          relevance_type not null default 'High',
  recommended_mix   jsonb not null default '{}'::jsonb,
  sector_applicability jsonb not null default '{}'::jsonb,
  unique (occasion_key, year)
);

-- ─────────────────────────────────────────────────────────
-- 5. SYSTEM tables
-- ─────────────────────────────────────────────────────────
create table if not exists public.routing_decisions (
  decision_id           uuid primary key default gen_random_uuid(),
  brand_id              uuid, -- nullable for system-level decisions
  flow_id               text not null,
  request_type          text,
  pipeline_assigned     text,
  agents_dispatched     jsonb not null default '[]'::jsonb,
  constraints_applied   jsonb not null default '{}'::jsonb,
  confidence_mode       confidence_mode_type,
  outcome               text,
  "timestamp"           timestamptz not null default now()
);

create table if not exists public.branddna_event_log (
  event_id    uuid primary key default gen_random_uuid(),
  brand_id    uuid, -- anonymised to null on PDPL delete
  event_type  event_type_enum not null,
  event_data  jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.memory_controller_queue (
  nomination_id      uuid primary key default gen_random_uuid(),
  brand_id           uuid references public.brand_profiles(brand_id) on delete cascade,
  nomination_type    nomination_type_enum not null,
  nomination_data    jsonb not null default '{}'::jsonb,
  nominated_by       text not null default 'CEO',
  nominated_at       timestamptz not null default now(),
  status             nomination_status_type not null default 'pending',
  processed_at       timestamptz,
  rejection_reason   text
);

create table if not exists public.confidence_classifications (
  classification_id  uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.brand_profiles(brand_id) on delete cascade,
  mode               confidence_mode_type not null,
  reasons            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  superseded_at      timestamptz
);

create table if not exists public.qa_review_queue (
  queue_id        uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  post_id         uuid,
  caption_ar      text,
  cco_score       float,
  flags           jsonb not null default '{}'::jsonb,
  trigger_reason  text,
  status          qa_status_type not null default 'pending',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create table if not exists public.usage_logs (
  log_id       uuid primary key default gen_random_uuid(),
  brand_id     uuid references public.brand_profiles(brand_id) on delete set null,
  flow_id      text,
  node_name    text,
  cost_usd     numeric(10,4) default 0,
  duration_ms  int,
  status       text,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.anomaly_records (
  anomaly_id   uuid primary key default gen_random_uuid(),
  brand_id     uuid references public.brand_profiles(brand_id) on delete set null,
  anomaly_type text not null,
  severity     text not null default 'warning',
  details      jsonb not null default '{}'::jsonb,
  resolved     boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.calendars (
  calendar_id   uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brand_profiles(brand_id) on delete cascade,
  month         text not null,                  -- YYYY-MM
  status        text not null default 'draft',  -- draft | delivered
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  unique (brand_id, month)
);

create table if not exists public.calendar_posts (
  post_id         uuid primary key default gen_random_uuid(),
  calendar_id     uuid not null references public.calendars(calendar_id) on delete cascade,
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  position        int not null check (position between 1 and 20),
  caption_ar      text,
  hashtags        text[] not null default '{}',
  content_type    text,
  posting_time    timestamptz,
  storage_url     text, -- Supabase Storage URL only (Hard Rule #4)
  confidence_score float,
  watermark       boolean not null default false,
  status          text not null default 'draft',
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (calendar_id, position),
  -- Hard Rule #4 enforced at the DB layer as a final safety net
  constraint no_weavy_urls check (storage_url is null or storage_url not like '%weavy.ai%')
);

create table if not exists public.deletion_audit_log (
  audit_id         uuid primary key default gen_random_uuid(),
  brand_id         uuid, -- original brand_id, kept for audit only
  phase1_complete  boolean not null default false,
  phase2_complete  boolean not null default false,
  last_attempt_at  timestamptz,
  retries          int not null default 0,
  error_details    jsonb,
  deleted_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────
-- 6. updated_at trigger helper + attach to mutable tables
-- ─────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_brand_profiles_updated on public.brand_profiles;
create trigger trg_brand_profiles_updated
  before update on public.brand_profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 7. Indexes (Doc §7.3)
-- ─────────────────────────────────────────────────────────
create index if not exists idx_evidence_bundles_brand_id on public.evidence_bundles(brand_id);
create index if not exists idx_source_records_brand_id   on public.source_records(brand_id);
create index if not exists idx_routing_decisions_brand   on public.routing_decisions(brand_id);
create index if not exists idx_usage_logs_brand_month    on public.usage_logs(brand_id, created_at);
create index if not exists idx_brand_profiles_shard      on public.brand_profiles(batch_shard, tier);
create index if not exists idx_qa_queue_status           on public.qa_review_queue(status, created_at);
create index if not exists idx_event_log_brand_type      on public.branddna_event_log(brand_id, event_type);
create index if not exists idx_confidence_active         on public.confidence_classifications(brand_id)
  where superseded_at is null;
create index if not exists idx_calendar_posts_calendar   on public.calendar_posts(calendar_id);
create index if not exists idx_anomaly_unresolved        on public.anomaly_records(resolved, created_at)
  where resolved = false;

-- ─────────────────────────────────────────────────────────
-- 8. Row Level Security (Doc §7.2)
-- ─────────────────────────────────────────────────────────
-- Helper: every table with client ownership
alter table public.brand_profiles          enable row level security;
alter table public.audience_profiles        enable row level security;
alter table public.visual_style_profiles    enable row level security;
alter table public.channel_profiles         enable row level security;
alter table public.evidence_bundles         enable row level security;
alter table public.source_records           enable row level security;
alter table public.negative_patterns        enable row level security;
alter table public.override_rules           enable row level security;
alter table public.onboarding_responses     enable row level security;
alter table public.onboarding_questions     enable row level security;
alter table public.brand_performance_log    enable row level security;
alter table public.brand_snapshots          enable row level security;
alter table public.sector_baselines         enable row level security;
alter table public.sector_question_weights  enable row level security;
alter table public.sector_trends            enable row level security;
alter table public.content_performance_patterns enable row level security;
alter table public.negative_pattern_library enable row level security;
alter table public.onboarding_intelligence  enable row level security;
alter table public.visual_performance_global enable row level security;
alter table public.occasion_intelligence    enable row level security;
alter table public.routing_decisions        enable row level security;
alter table public.branddna_event_log       enable row level security;
alter table public.memory_controller_queue  enable row level security;
alter table public.confidence_classifications enable row level security;
alter table public.qa_review_queue          enable row level security;
alter table public.usage_logs               enable row level security;
alter table public.anomaly_records          enable row level security;
alter table public.calendars                enable row level security;
alter table public.calendar_posts           enable row level security;
alter table public.deletion_audit_log       enable row level security;

-- Layer 1 client isolation — brand_id matched via auth_user_id = auth.uid()
-- (auth.uid() is the Supabase-authed user; we keep the brand's auth_user_id mapping there)
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'audience_profiles','visual_style_profiles','channel_profiles',
    'evidence_bundles','source_records','negative_patterns','override_rules',
    'onboarding_responses','brand_performance_log','brand_snapshots'
  ]
  loop
    execute format($f$
      drop policy if exists client_read on public.%1$I;
      create policy client_read on public.%1$I
        for select using (
          exists (
            select 1 from public.brand_profiles bp
            where bp.brand_id = %1$I.brand_id and bp.auth_user_id = auth.uid()
          )
        );
    $f$, tbl);
  end loop;
end $$;

-- brand_profiles — client can SELECT/UPDATE their own
drop policy if exists client_own_select on public.brand_profiles;
create policy client_own_select on public.brand_profiles
  for select using (auth_user_id = auth.uid());

drop policy if exists client_own_update on public.brand_profiles;
create policy client_own_update on public.brand_profiles
  for update using (auth_user_id = auth.uid());

-- Layer 2 / Layer 3 — authenticated read only
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'sector_baselines','sector_question_weights','sector_trends',
    'content_performance_patterns','negative_pattern_library',
    'onboarding_intelligence','visual_performance_global','occasion_intelligence',
    'onboarding_questions'
  ]
  loop
    execute format($f$
      drop policy if exists global_read on public.%1$I;
      create policy global_read on public.%1$I
        for select using (auth.role() = 'authenticated' or auth.role() = 'anon');
    $f$, tbl);
  end loop;
end $$;

-- Append-only tables: INSERT allowed, UPDATE/DELETE blocked
do $$
declare tbl text;
begin
  foreach tbl in array array['routing_decisions','branddna_event_log']
  loop
    execute format($f$
      drop policy if exists insert_only on public.%1$I;
      create policy insert_only on public.%1$I for insert with check (true);

      drop policy if exists no_update on public.%1$I;
      create policy no_update on public.%1$I for update using (false);

      drop policy if exists no_delete on public.%1$I;
      create policy no_delete on public.%1$I for delete using (false);

      drop policy if exists read_own on public.%1$I;
      create policy read_own on public.%1$I
        for select using (
          brand_id is null or exists (
            select 1 from public.brand_profiles bp
            where bp.brand_id = %1$I.brand_id and bp.auth_user_id = auth.uid()
          )
        );
    $f$, tbl);
  end loop;
end $$;

-- Admin (service_role) bypasses RLS; we also expose explicit admin_full policies for clarity
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'brand_profiles','audience_profiles','visual_style_profiles','channel_profiles',
    'evidence_bundles','source_records','negative_patterns','override_rules',
    'onboarding_responses','onboarding_questions','brand_performance_log','brand_snapshots',
    'sector_baselines','sector_question_weights','sector_trends',
    'content_performance_patterns','negative_pattern_library',
    'onboarding_intelligence','visual_performance_global','occasion_intelligence',
    'routing_decisions','branddna_event_log','memory_controller_queue',
    'confidence_classifications','qa_review_queue','usage_logs','anomaly_records',
    'calendars','calendar_posts','deletion_audit_log'
  ]
  loop
    execute format($f$
      drop policy if exists admin_full on public.%1$I;
      create policy admin_full on public.%1$I
        for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
    $f$, tbl);
  end loop;
end $$;

-- Calendars & calendar_posts — clients can read their own
drop policy if exists client_read_calendars on public.calendars;
create policy client_read_calendars on public.calendars
  for select using (
    exists (select 1 from public.brand_profiles bp where bp.brand_id = calendars.brand_id and bp.auth_user_id = auth.uid())
  );

drop policy if exists client_read_calendar_posts on public.calendar_posts;
create policy client_read_calendar_posts on public.calendar_posts
  for select using (
    exists (select 1 from public.brand_profiles bp where bp.brand_id = calendar_posts.brand_id and bp.auth_user_id = auth.uid())
  );

commit;
