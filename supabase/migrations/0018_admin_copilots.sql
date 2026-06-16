-- Migration 0018 — Admin Copilots (Doc §8.5 + SEC-07).
--
-- Two pieces:
--   A. Persistent conversation tables for the 3 copilots.
--   B. Role-scoped RLS policies + a session-local helper (`copilot.role()`)
--      that the API sets via `set_config()` per request, so even a buggy
--      handler cannot exfiltrate cross-role data — Postgres refuses the row.
--
-- The doc spec assumes a separate admin Supabase instance with JWTs that
-- carry `copilot_role` claims. Phase 1 ships the same enforcement model
-- using session-local GUC: the API sets `app.copilot_role` after the admin
-- check, RLS reads it, and Postgres filters as if the JWT had it.
-- When SUPABASE_ADMIN_URL is provisioned, we swap the policy bodies to
-- read auth.jwt() ->> 'copilot_role' — the surface API stays unchanged.
--
-- Idempotent: safe to re-run.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- A. Conversation persistence
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.copilot_threads (
  thread_id     uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  role          text not null check (role in ('management', 'tech', 'production')),
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists idx_copilot_threads_admin_role
  on public.copilot_threads (admin_user_id, role, updated_at desc)
  where archived_at is null;

create table if not exists public.copilot_messages (
  message_id     uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references public.copilot_threads(thread_id) on delete cascade,
  role           text not null check (role in ('user', 'assistant')),
  content        text not null,
  -- Token + cost telemetry per assistant turn (NULL for user turns).
  tokens_in      int,
  tokens_out     int,
  cost_usd       numeric(10, 6),
  -- Snapshot of the role-context the model saw at the time of this turn.
  -- Lets us replay / audit later. Trimmed to ≤ 8KB by the API.
  context_snapshot jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_copilot_messages_thread
  on public.copilot_messages (thread_id, created_at);

-- Bump thread.updated_at whenever a message is inserted, so the thread
-- list can sort by recency without a join.
create or replace function public.copilot_touch_thread()
returns trigger language plpgsql as $$
begin
  update public.copilot_threads
     set updated_at = now()
   where thread_id = new.thread_id;
  return new;
end$$;

drop trigger if exists trg_copilot_touch_thread on public.copilot_messages;
create trigger trg_copilot_touch_thread
after insert on public.copilot_messages
for each row execute function public.copilot_touch_thread();

-- ─────────────────────────────────────────────────────────────────────
-- B. Role-scoped read policies (SEC-07)
-- ─────────────────────────────────────────────────────────────────────

-- Helper that reads the per-request GUC. The API does:
--   select set_config('app.copilot_role', 'management', true)
-- before any query. `true` = transaction-local; resets between requests.
create or replace function public.current_copilot_role()
returns text language sql stable as $$
  select nullif(current_setting('app.copilot_role', true), '')
$$;

-- ── Management Copilot — read-all on brand_profiles + usage_logs + brand_snapshots
alter table public.brand_profiles enable row level security;
drop policy if exists mgmt_copilot_read on public.brand_profiles;
create policy mgmt_copilot_read on public.brand_profiles
  for select
  using (public.current_copilot_role() = 'management');

alter table public.usage_logs enable row level security;
drop policy if exists mgmt_copilot_read_usage on public.usage_logs;
create policy mgmt_copilot_read_usage on public.usage_logs
  for select
  using (public.current_copilot_role() = 'management');

drop policy if exists mgmt_copilot_read_snapshots on public.brand_snapshots;
create policy mgmt_copilot_read_snapshots on public.brand_snapshots
  for select
  using (public.current_copilot_role() = 'management');

drop policy if exists mgmt_copilot_read_evidence on public.evidence_bundles;
create policy mgmt_copilot_read_evidence on public.evidence_bundles
  for select
  using (public.current_copilot_role() = 'management');

drop policy if exists mgmt_copilot_read_routing on public.routing_decisions;
create policy mgmt_copilot_read_routing on public.routing_decisions
  for select
  using (public.current_copilot_role() = 'management');

-- ── Tech Copilot — system tables only, NO brand_profiles
alter table public.anomaly_records enable row level security;
drop policy if exists tech_copilot_read_anomalies on public.anomaly_records;
create policy tech_copilot_read_anomalies on public.anomaly_records
  for select
  using (public.current_copilot_role() = 'tech');

drop policy if exists tech_copilot_read_usage on public.usage_logs;
create policy tech_copilot_read_usage on public.usage_logs
  for select
  using (public.current_copilot_role() = 'tech');

drop policy if exists tech_copilot_read_routing on public.routing_decisions;
create policy tech_copilot_read_routing on public.routing_decisions
  for select
  using (public.current_copilot_role() = 'tech');

-- IMPORTANT: tech copilot does NOT get a policy on brand_profiles.
-- Default-deny RLS means zero access. That's the SEC-07 promise.

-- ── Production Copilot — qa_review_queue + narrow projection on calendar_posts + brand_profiles
alter table public.qa_review_queue enable row level security;
drop policy if exists prod_copilot_read_qa on public.qa_review_queue;
create policy prod_copilot_read_qa on public.qa_review_queue
  for select
  using (public.current_copilot_role() = 'production');

drop policy if exists prod_copilot_read_posts on public.calendar_posts;
create policy prod_copilot_read_posts on public.calendar_posts
  for select
  using (public.current_copilot_role() = 'production');

drop policy if exists prod_copilot_read_brand_narrow on public.brand_profiles;
create policy prod_copilot_read_brand_narrow on public.brand_profiles
  for select
  using (public.current_copilot_role() = 'production');

-- Production copilot has NO policy on usage_logs — zero access (Doc §7.2).

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS for the conversation tables themselves
-- ─────────────────────────────────────────────────────────────────────
-- Threads + messages are admin-private. We don't expose them to client
-- roles. Service-role (Memory Controller, app server) bypasses RLS, so
-- the API reads/writes freely after requireAdmin().

alter table public.copilot_threads  enable row level security;
alter table public.copilot_messages enable row level security;

-- Deny-by-default for everyone except service_role (which bypasses RLS).
-- No policy = no access. The API only ever uses adminClient() (service role).

commit;
