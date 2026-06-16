-- Migration 0111: Persist the CCO's structured scoring signals on calendar_posts
--
-- THE BUG THIS FIXES
-- The CCO agent (packages/core/src/schemas/cco.ts) returns, per post:
--   score, negpat_flag, dialect_flag, cultural_flag, brave_route_flag, issues[]
-- plus (v2) an internal method_adherence_score. Until now ONLY `cco_score` had a
-- home on calendar_posts. The A01 Skeleton Builder's insert object DID list
-- negpat_flag / dialect_flag / brave_route_flag — but PostgREST silently DROPS
-- keys with no matching column, so every one of those signals was thrown away.
-- The richest "why this score" signal, `issues[]`, was never even attempted.
--
-- Net effect: the score number survived, the REASONS behind it did not. The QA
-- "why this score" panel therefore had nothing to explain a clean post's score.
--
-- THE FIX
-- Add first-class columns so the full CCO evaluation persists with each post and
-- is queryable for the Admin QA UI, analytics, and chain-learning. `cco_issues`
-- is JSONB (an array of issue tags) to avoid a brittle enum that must change
-- whenever the CCO vocabulary grows.
--
-- Idempotent: every statement guards with IF NOT EXISTS.

alter table public.calendar_posts
  -- Severity of the negative-pattern match: NONE | SOFT_WARN | STRONG_WARN | HARD_BLOCK.
  add column if not exists negpat_flag            text    not null default 'NONE',
  -- Boolean compliance flags from the CCO evaluation.
  add column if not exists dialect_flag           boolean not null default false,
  add column if not exists cultural_flag          boolean not null default false,
  add column if not exists brave_route_flag       boolean not null default false,
  -- The controlled-vocabulary issue tags (CcoIssue[]) — the structured "why".
  -- JSONB array, e.g. ["tone_drift","voice_register_mismatch"]. Empty = clean.
  add column if not exists cco_issues             jsonb   not null default '[]'::jsonb,
  -- v2 method-adherence sub-score (0–100), the 30% component of the final score.
  -- Nullable: null = not graded (no method profile reached the CCO).
  add column if not exists method_adherence_score float;

comment on column public.calendar_posts.negpat_flag is
  'CCO negative-pattern severity: NONE | SOFT_WARN | STRONG_WARN | HARD_BLOCK.';
comment on column public.calendar_posts.cco_issues is
  'CCO issue tags (CcoIssue[]) — the structured reasons behind cco_score. JSONB array; [] means no issues raised.';
comment on column public.calendar_posts.method_adherence_score is
  'v2 method-adherence sub-score (0–100). NULL = method was not graded (no method_profile reached the CCO).';

-- Partial index: fast lookup of posts carrying any CCO issue (for QA triage /
-- analytics "which issues are most common"). Only indexes rows that have issues.
create index if not exists idx_calendar_posts_cco_issues
  on public.calendar_posts using gin (cco_issues)
  where cco_issues <> '[]'::jsonb;
