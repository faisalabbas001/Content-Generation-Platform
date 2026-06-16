-- Migration 0025 — Read-time recency decay for source_records
--
-- Background:
--   The `source_records.recency_score` column was always 1.0 because no
--   process ever decayed it. The intent (per docs/db/database-guide.md and
--   docs/doc.md) is "0-1, decays with age, used by COO confidence math".
--
-- Strategy:
--   Don't decay the stored value (would require a cron + would mutate an
--   append-only table). Instead, expose a SQL function `compute_recency_score`
--   that returns the decayed value at read time, plus a view
--   `source_records_with_recency` that surfaces it as a regular column.
--
-- Decay formula: exponential half-life of 60 days.
--   recency = exp(-age_days / 60)
--   Day 0:    1.000
--   Day 30:   0.607
--   Day 60:   0.368  (1 half-life ≈ ln(2)*60 ≈ 41.6d, so 60d = 0.368)
--   Day 90:   0.223
--   Day 180:  0.050
--   Day 365:  0.002
--
--   Clamped to [0.01, 1.0] — never exactly zero (so old evidence still
--   contributes a tiny weight rather than vanishing entirely).
--
-- Idempotent — replaces the function on re-run.

begin;

create or replace function public.compute_recency_score(captured_at timestamptz)
returns float
language sql
immutable
parallel safe
as $$
  select greatest(0.01, least(1.0,
    exp(- extract(epoch from (now() - captured_at)) / (60.0 * 86400.0))
  ))::float
$$;

comment on function public.compute_recency_score(timestamptz) is
  'Read-time recency decay for source_records. Exponential, 60-day time constant.
   Day 0=1.0, Day 60=0.37, Day 180=0.05. Clamped to [0.01, 1.0].
   Use this instead of source_records.recency_score (which is the immutable
   "as-captured" value, always 1.0).';

-- A SQL view that joins the live decay onto every source_records row.
-- Read this instead of the raw table when you need the live score.
-- The original column is exposed as `recency_score_at_capture` for audit
-- (it tells you the source claimed at write-time) — currently always 1.0.
create or replace view public.source_records_with_recency as
  select
    sr.source_id,
    sr.brand_id,
    sr.source_type,
    sr.raw_payload,
    sr.captured_at,
    sr.recency_score                              as recency_score_at_capture,
    public.compute_recency_score(sr.captured_at)  as recency_score
  from public.source_records sr;

-- The view inherits source_records' RLS policies because Postgres views run
-- as the invoker by default (PostgREST exposes them with security_invoker=on
-- when the view's `security_invoker` reloption is set).
alter view public.source_records_with_recency set (security_invoker = on);

grant select on public.source_records_with_recency to anon, authenticated, service_role;

-- Quick verification: a hand-picked sample shows the decay tier.
do $$
declare
  c1 float; c2 float; c3 float;
begin
  c1 := public.compute_recency_score(now());
  c2 := public.compute_recency_score(now() - interval '60 days');
  c3 := public.compute_recency_score(now() - interval '180 days');
  raise notice 'Recency decay sanity: today=%, 60d=%, 180d=%', c1, c2, c3;
  if c1 < 0.99 or c1 > 1.0 then
    raise exception 'today recency expected ~1.0, got %', c1;
  end if;
  if c2 < 0.30 or c2 > 0.45 then
    raise exception '60-day recency expected ~0.37, got %', c2;
  end if;
end $$;

commit;
