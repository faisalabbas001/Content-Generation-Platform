-- OpenClaw — 0009_on_demand_requests
-- Adds the on-demand single-post pipeline (N8N-A02 trigger).
--
-- Doc references:
--   §3.2 — every generation event (batch or on-demand) flows through CEO first
--   §5.1 — N8N-A02: Webhook → "On-demand single post — same chain as A01"
--   §10.1 — SLA < 5 min from Generate Post click → caption + visual delivered
--
-- Why a new table (on_demand_requests):
--   The existing schema (0001) models the deliverable as `calendars` (1 per
--   month) → `calendar_posts` (1..20). On-demand is a single user-initiated
--   request with a custom brief that does not necessarily slot into the
--   monthly 20-post calendar. We need a place to:
--     (a) capture the full visual + caption brief from the dashboard form,
--     (b) correlate the n8n run end-to-end (status, timing, SLA tracking),
--     (c) tie the resulting calendar_posts row back to its originating brief.
--
--   We do NOT replace calendars/calendar_posts — once n8n produces the post
--   it is written to calendar_posts as usual (so the calendar dashboard,
--   QA queue and PDPL cascade keep working unchanged). on_demand_requests
--   simply links to that post via post_id.
--
-- Schema changes in this migration:
--   1. CREATE  on_demand_requests        — request brief + status + correlation.
--   2. ALTER   calendar_posts.calendar_id → nullable + CHECK ensuring exactly
--              one of (calendar_id, on_demand_request_id) is set.
--   3. ALTER   calendar_posts.position   → relaxed to allow 0 (on-demand uses
--              the column for ordering inside the month bucket; the unique
--              key (calendar_id, position) only applies to monthly posts).
--   4. ADD     calendar_posts.route_decision (clean | watermark | hold) so the
--              CEO confidence-gate verdict is explicit instead of inferred
--              from the watermark bool + status string.
--   5. ADD     calendar_posts.on_demand_request_id (FK back to brief).
--   6. RLS     for on_demand_requests — same client-isolation pattern as
--              other Layer 1 tables (read/insert when you own the brand).
--
-- Idempotent: every CREATE/ALTER guarded with IF [NOT] EXISTS or do-blocks.

begin;

-- ─────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────
do $$ begin
  create type on_demand_status_type as enum (
    'queued',       -- written by /api/posts/on-demand, n8n not yet ack'd
    'generating',   -- n8n picked it up, CEO/COO/DeepSeek/CCO running
    'delivered',    -- post landed in calendar_posts, image in Storage
    'held',         -- CEO confidence-gate sent it to qa_review_queue
    'failed'        -- final n8n failure after retries (anomaly logged)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type post_route_decision_type as enum ('clean','watermark','hold');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────
-- 2. on_demand_requests — the user-submitted brief
-- ─────────────────────────────────────────────────────────
create table if not exists public.on_demand_requests (
  request_id          uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brand_profiles(brand_id) on delete cascade,

  -- Caption brief (Doc §3.2 — DeepSeek inputs + metadata)
  content_type        text        not null,                -- lifestyle | offer | educational | testimonial | announcement
  objective           text        not null,                -- awareness | engagement | conversion | cultural | trust
  platform            channel_type not null,
  posting_time        timestamptz,
  month               text        not null check (month ~ '^\d{4}-\d{2}$'),
  posts_per_week      int         not null default 1 check (posts_per_week between 1 and 7),
  occasion_name       text,
  occasion_lead_weeks int         default 0 check (occasion_lead_weeks between 0 and 12),
  occasion_priority   relevance_type,
  hashtags            text[]      not null default '{}',

  -- Visual brief (Doc §6.2 / §9.2 — English-only, Hard Rule #3)
  style_descriptor    text        not null,
  hero_concept        text        not null,
  negative_prompt     text,
  cultural_guidance   text,
  canvas              text        not null check (canvas in ('ig_square','ig_portrait','ig_story','snap')),
  color_palette       text[]      not null default '{}',

  -- Generation controls (Doc §3.3 N8N-V01 model select)
  image_model_pref    text        not null default 'auto' check (image_model_pref in ('auto','nano_banana','flux_ultra','fal_flux','fal_nano')),
  first_ever_post     boolean     not null default false,
  overlay_brand_name_ar boolean   not null default true,

  -- Lifecycle / correlation
  status              on_demand_status_type not null default 'queued',
  -- The CEO confidence-mode decided at the start of this run. Cached here so
  -- the dashboard can render it without re-deriving.
  confidence_mode     confidence_mode_type,
  -- Once n8n finishes, this points at the calendar_posts row that was created.
  post_id             uuid,
  -- n8n correlation — the request id we sign + send out, so n8n callbacks
  -- (POST /api/webhooks/n8n) can match completion events back to this row.
  n8n_request_id      text,
  -- Free-form failure cause when status='failed'.
  failure_reason      text,
  -- Audit: who submitted (the auth.uid() at submit time).
  submitted_by        uuid,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  delivered_at        timestamptz
);

create index if not exists idx_on_demand_requests_brand
  on public.on_demand_requests (brand_id, created_at desc);

create index if not exists idx_on_demand_requests_status
  on public.on_demand_requests (status, created_at)
  where status in ('queued','generating');

create index if not exists idx_on_demand_requests_n8n_corr
  on public.on_demand_requests (n8n_request_id)
  where n8n_request_id is not null;

-- updated_at trigger reuses the helper from 0001
drop trigger if exists trg_on_demand_requests_updated on public.on_demand_requests;
create trigger trg_on_demand_requests_updated
  before update on public.on_demand_requests
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 3. calendar_posts — relax + correlate to on-demand
-- ─────────────────────────────────────────────────────────
-- 3a. Make calendar_id nullable (on-demand posts have no monthly calendar).
alter table public.calendar_posts
  alter column calendar_id drop not null;

-- 3b. Drop the strict 1..20 position check (on-demand uses 0).
do $$
declare cons_name text;
begin
  select conname into cons_name from pg_constraint
   where conrelid = 'public.calendar_posts'::regclass
     and pg_get_constraintdef(oid) ilike '%position between 1 and 20%';
  if cons_name is not null then
    execute format('alter table public.calendar_posts drop constraint %I', cons_name);
  end if;
end $$;

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'calendar_posts_position_range_chk'
       and conrelid = 'public.calendar_posts'::regclass
  ) then
    alter table public.calendar_posts
      add constraint calendar_posts_position_range_chk
      check (position between 0 and 50) not valid;
    alter table public.calendar_posts validate constraint calendar_posts_position_range_chk;
  end if;
end $mig$;

-- 3c. Add explicit route_decision column (clean | watermark | hold).
alter table public.calendar_posts
  add column if not exists route_decision post_route_decision_type;

-- 3d. Add on_demand_request_id FK back to the brief.
alter table public.calendar_posts
  add column if not exists on_demand_request_id uuid
    references public.on_demand_requests(request_id) on delete set null;

create index if not exists idx_calendar_posts_on_demand_req
  on public.calendar_posts (on_demand_request_id)
  where on_demand_request_id is not null;

-- 3e. Exactly-one parent invariant: every post belongs to either a monthly
--     calendar OR an on-demand request, never both, never neither.
alter table public.calendar_posts
  drop constraint if exists calendar_posts_one_parent_chk;
alter table public.calendar_posts
  add constraint calendar_posts_one_parent_chk check (
    (calendar_id is not null and on_demand_request_id is null)
    or
    (calendar_id is null and on_demand_request_id is not null)
  ) not valid;
-- Existing 0001/seed data was all monthly (calendar_id NOT NULL), so the
-- constraint validates without touching rows. We still mark NOT VALID first
-- in case dummy data is loose, then validate.
alter table public.calendar_posts validate constraint calendar_posts_one_parent_chk;

-- ─────────────────────────────────────────────────────────
-- 4. on_demand_requests.post_id FK (added after column exists on both sides)
-- ─────────────────────────────────────────────────────────
do $$ begin
  alter table public.on_demand_requests
    add constraint on_demand_requests_post_fk
    foreign key (post_id) references public.calendar_posts(post_id) on delete set null;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────
-- 5. RLS — same client-isolation pattern as other Layer 1 tables
-- ─────────────────────────────────────────────────────────
alter table public.on_demand_requests enable row level security;

-- SELECT — only the brand owner can read.
drop policy if exists client_read on public.on_demand_requests;
create policy client_read on public.on_demand_requests
  for select using (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = on_demand_requests.brand_id
        and bp.auth_user_id = auth.uid()
    )
  );

-- INSERT — the brand owner inserts their own brief from the dashboard.
drop policy if exists client_own_insert on public.on_demand_requests;
create policy client_own_insert on public.on_demand_requests
  for insert with check (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = on_demand_requests.brand_id
        and bp.auth_user_id = auth.uid()
    )
    and submitted_by = auth.uid()
  );

-- UPDATE — clients DO NOT update directly. n8n callbacks use service_role.
-- (No client_update policy → RLS denies by default.)

-- service_role bypass for n8n callbacks + admin tools.
drop policy if exists admin_full on public.on_demand_requests;
create policy admin_full on public.on_demand_requests
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

commit;
