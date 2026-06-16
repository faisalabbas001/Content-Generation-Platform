-- OpenClaw — 0019_copilot_missing_columns
-- Doc §8.5 — Admin Copilot context fetchers (packages/db/src/queries/copilot-context.ts)
-- reference columns that do not yet exist in three system tables.
-- Without this migration every Copilot API call returns a PostgreSQL error.
--
-- What this migration adds (nothing else is changed):
--
--   TABLE          COLUMN           TYPE              USED BY
--   usage_logs     provider         text              Management + Tech copilot spend breakdown
--   anomaly_records source_flow     text              Tech copilot recent_anomalies context
--   anomaly_records message         text              Tech copilot recent_anomalies context
--   qa_review_queue held_reason     text              Production copilot oldest_pending + cco_failures
--   qa_review_queue reviewed_at     timestamptz       Production copilot approved_today / rejected_today
--   qa_status_type  'escalated'     enum value        Production copilot escalated count
--
-- No existing tables, columns, constraints, RLS policies, or data are modified.
-- Migration 0018 already added the correct role-scoped SELECT policies on all
-- three tables for the copilot roles — the new columns are automatically covered
-- by those existing policies (SELECT * includes all columns, present and future).
--
-- Idempotent: every statement guarded with IF NOT EXISTS or ADD VALUE IF NOT EXISTS.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — Extend qa_status_type enum
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: PostgreSQL 12+ allows ALTER TYPE ADD VALUE inside a transaction block
-- when IF NOT EXISTS is used, provided the new value is not consumed in the same
-- transaction. Supabase runs PG 15, so this is safe here.
-- The custom db:migrate runner manages the outer BEGIN/COMMIT — no nested block.
alter type public.qa_status_type add value if not exists 'escalated';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — Column additions
-- ─────────────────────────────────────────────────────────────────────────────
-- (Transaction is managed by the db:migrate runner — no begin/commit here.)

-- usage_logs.provider
-- Which AI provider was called for this log entry.
-- Examples: 'anthropic', 'openai', 'deepseek', 'weavy'
-- NULL for legacy rows written before this migration.
alter table public.usage_logs
  add column if not exists provider text;

-- anomaly_records.source_flow
-- The n8n flow ID that produced this anomaly record.
-- Examples: 'N8N-A01', 'N8N-A02', 'N8N-V01', 'N8N-S01'
-- NULL for anomalies not tied to a specific flow.
alter table public.anomaly_records
  add column if not exists source_flow text;

-- anomaly_records.message
-- Human-readable error summary. Previously buried inside details JSONB.
-- The Tech Copilot surfaces this directly; redactSecrets() strips any API keys
-- before sending to Claude (see copilot.ts).
-- NULL for anomalies with no plain-text message.
alter table public.anomaly_records
  add column if not exists message text;

-- qa_review_queue.held_reason
-- Reason code explaining why this post was sent to the QA queue.
-- Convention: prefixed by the component that held it.
-- Examples: 'cco_negpat_hard_block', 'cco_low_score', 'dialect_low_confidence',
--           'brave_route_flagged', 'first_ever_post', 'third_revision'
-- NULL for rows created before this migration.
alter table public.qa_review_queue
  add column if not exists held_reason text;

-- qa_review_queue.reviewed_at
-- Timestamp set when a human reviewer approves, rejects, or edits the post.
-- The Production Copilot uses this to compute approved_today / rejected_today.
-- NULL means the post has not yet been reviewed.
alter table public.qa_review_queue
  add column if not exists reviewed_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — Targeted indexes for copilot query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- Management + Tech Copilot: GROUP BY provider ORDER BY sum(cost_usd)
-- Partial index (skip NULL rows — legacy rows have no provider).
create index if not exists idx_usage_logs_provider_created
  on public.usage_logs (provider, created_at)
  where provider is not null;

-- Tech Copilot: source_flow in anomaly context window query
create index if not exists idx_anomaly_records_source_flow
  on public.anomaly_records (source_flow, created_at)
  where source_flow is not null;

-- Production Copilot: held_reason ilike 'cco_%' scan
create index if not exists idx_qa_review_queue_held_reason
  on public.qa_review_queue (held_reason, created_at)
  where held_reason is not null;

-- Production Copilot: reviewed_at::date = current_date filter
create index if not exists idx_qa_review_queue_reviewed_at
  on public.qa_review_queue (reviewed_at)
  where reviewed_at is not null;

-- (commit is handled by db:migrate runner)
