-- OpenClaw — 0030_brand_vector_namespace
-- Persists the per-brand Qdrant collection name on brand_profiles so the
-- audit trail covers which brands have a vector namespace provisioned
-- (Doc §3.2, §5.3 step 4).
--
-- Why a column instead of relying on convention: the collection name is
-- derived from brand_id today, but downstream readers (A01 calendar, V01
-- vision) need to know whether setup actually succeeded vs. was skipped
-- (qdrant_not_configured). A nullable column captures both.

begin;

alter table public.brand_profiles
  add column if not exists vector_namespace text;

comment on column public.brand_profiles.vector_namespace is
  'Per-brand Qdrant collection name set by /api/vectors/setup at the end of '
  'N8N-A03 onboarding. NULL = setup never ran or was skipped (e.g. Qdrant '
  'unavailable). Append-only writes from the service role.';

commit;
