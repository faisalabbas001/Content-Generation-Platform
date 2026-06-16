-- 0038 — brand_performance_log: add scoring & offer tracking columns
--
-- Context:
--   N8N-A05 runs on the 1st of each month. It calculates a composite readiness
--   score (frequency 25%, quality 30%, completeness 20%, loyalty 15%, COO 10%)
--   for every free-tier brand, assigns a readiness_tier, and writes a
--   personalised upgrade offer. ALL free brands get an offer — the tier is used
--   for personalisation only, not as a gate.
--
--   The frontend reads this table to show an UpgradeOfferBanner on the dashboard.
--   The PATCH /api/offers/[id]/status endpoint writes offer_status back.
--   The Stripe webhook marks offers as 'converted' on successful upgrade.
--
--   Previous shape: perf_id, brand_id, post_id, metric_key (NOT NULL),
--                   metric_value, captured_at.
--   metric_key is made nullable so new upgrade_readiness rows (which do not
--   use the generic key/value pattern) don't violate the constraint.

begin;

-- ── Relax legacy constraint ───────────────────────────────────────────────────
alter table public.brand_performance_log
  alter column metric_key drop not null;

-- ── N8N-A05 evaluation columns ────────────────────────────────────────────────
alter table public.brand_performance_log
  add column if not exists evaluation_type        text,
  add column if not exists metrics                jsonb,
  add column if not exists scores                 jsonb,
  add column if not exists total_score            float,
  add column if not exists readiness_tier         text,
  add column if not exists batch_id               text,
  add column if not exists evaluated_at           timestamptz;

-- ── Offer tracking columns ────────────────────────────────────────────────────
alter table public.brand_performance_log
  add column if not exists activity_level           text,
  add column if not exists upgrade_recommendation   text,
  add column if not exists upgrade_recommendation_ar text,
  add column if not exists suggested_offer          text,
  add column if not exists suggested_offer_ar       text,
  add column if not exists offer_valid_until        date
    default (now() + interval '30 days')::date,
  add column if not exists offer_status            text default 'pending';

comment on column public.brand_performance_log.evaluation_type is
  'Row type discriminator. upgrade_readiness = N8N-A05 monthly scoring run.';
comment on column public.brand_performance_log.offer_status is
  'Offer lifecycle: pending → accepted | skipped | expired | converted';
comment on column public.brand_performance_log.activity_level is
  'Legacy column — superseded by readiness_tier in upgrade_readiness rows.';

-- ── Index for dashboard active-offer lookup ───────────────────────────────────
-- Covers the query: WHERE brand_id=? AND evaluation_type='upgrade_readiness'
--                     AND offer_status='pending' AND offer_valid_until >= today
create index if not exists idx_bpl_offer_active
  on public.brand_performance_log (brand_id, offer_valid_until desc)
  where evaluation_type = 'upgrade_readiness' and offer_status = 'pending';

commit;
