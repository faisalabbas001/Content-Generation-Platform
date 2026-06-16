-- 0039 — evidence_bundles: index on last_evaluated
--
-- Context:
--   N8N-D02 runs SELECT ... WHERE last_evaluated < now() - interval '90 days' every month.
--   Without an index this is a sequential scan that grows with the table.
--   CONCURRENTLY avoids locking reads during index build — safe for production.
--   Cannot run inside a transaction block, so no begin/commit wrapper.

create index concurrently if not exists idx_evidence_bundles_last_evaluated
  on public.evidence_bundles (last_evaluated);
