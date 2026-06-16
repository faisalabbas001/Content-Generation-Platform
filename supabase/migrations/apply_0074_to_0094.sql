-- ═══════════════════════════════════════════════════════════════════════════════
-- COMBINED MIGRATION: 0074 → 0094
-- Apply this entire file in Supabase Dashboard → SQL Editor (Run All)
-- Safe to re-run: every DDL uses IF NOT EXISTS / IF EXISTS / OR REPLACE
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 0074: Cost monitoring — extend usage_logs + brand_cost_config
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS client_slug          text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS flow_run_id          text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS request_type         text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS model                text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS agent                text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_in            integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_out           integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_cached        integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS images_generated     integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_input       numeric(10,6);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_output      numeric(10,6);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_cached      numeric(10,6);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS monthly_ceiling_usd  numeric(10,2);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS error_code           text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS elapsed_ms           integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS payload              jsonb;

-- Drop dependent view before altering column type (recreated below)
DROP VIEW IF EXISTS v_brand_monthly_spend;
ALTER TABLE usage_logs
  ALTER COLUMN cost_usd TYPE numeric(10,6)
  USING cost_usd::numeric(10,6);

CREATE INDEX IF NOT EXISTS idx_usage_logs_brand_created ON usage_logs(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_created ON usage_logs(agent, created_at DESC) WHERE agent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_logs_flow_run_id   ON usage_logs(flow_run_id)            WHERE flow_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_logs_error_code    ON usage_logs(error_code)             WHERE error_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS brand_cost_config (
  brand_id             uuid        NOT NULL PRIMARY KEY REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  monthly_ceiling_usd  numeric(10,2) NOT NULL DEFAULT 50.00,
  tier                 text        NOT NULL DEFAULT 'standard' CHECK (tier IN ('starter','standard','professional','enterprise')),
  alert_at_pct         integer     NOT NULL DEFAULT 70  CHECK (alert_at_pct BETWEEN 1 AND 99),
  halt_at_pct          integer     NOT NULL DEFAULT 100 CHECK (halt_at_pct BETWEEN 1 AND 200),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_brand_cost_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_brand_cost_config_updated_at ON brand_cost_config;
CREATE TRIGGER trg_brand_cost_config_updated_at
  BEFORE UPDATE ON brand_cost_config
  FOR EACH ROW EXECUTE FUNCTION set_brand_cost_config_updated_at();

ALTER TABLE brand_cost_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_cost_config' AND policyname='brand_cost_config_owner_read') THEN
    CREATE POLICY brand_cost_config_owner_read ON brand_cost_config FOR SELECT TO authenticated
      USING (brand_id IN (SELECT brand_id FROM brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_cost_config' AND policyname='brand_cost_config_service_write') THEN
    CREATE POLICY brand_cost_config_service_write ON brand_cost_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO brand_cost_config (brand_id) SELECT brand_id FROM brand_profiles ON CONFLICT (brand_id) DO NOTHING;

CREATE OR REPLACE VIEW v_brand_monthly_spend AS
SELECT
  bc.brand_id, bc.monthly_ceiling_usd, bc.alert_at_pct, bc.halt_at_pct,
  COALESCE(SUM(ul.cost_usd),0)::numeric(10,6) AS current_month_spend_usd,
  ROUND(COALESCE(SUM(ul.cost_usd),0) / NULLIF(bc.monthly_ceiling_usd,0) * 100, 1) AS spend_pct,
  CASE
    WHEN COALESCE(SUM(ul.cost_usd),0) >= bc.monthly_ceiling_usd THEN 'breached'
    WHEN COALESCE(SUM(ul.cost_usd),0) >= bc.monthly_ceiling_usd * bc.halt_at_pct / 100.0 THEN 'critical'
    WHEN COALESCE(SUM(ul.cost_usd),0) >= bc.monthly_ceiling_usd * bc.alert_at_pct / 100.0 THEN 'approaching'
    ELSE 'normal'
  END AS cost_status
FROM brand_cost_config bc
LEFT JOIN usage_logs ul ON ul.brand_id = bc.brand_id
  AND ul.created_at >= date_trunc('month', now())
  AND ul.status = 'success'
GROUP BY bc.brand_id, bc.monthly_ceiling_usd, bc.alert_at_pct, bc.halt_at_pct;

GRANT SELECT ON v_brand_monthly_spend TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0075: system_config key-value table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
  key        text        NOT NULL PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_system_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION set_system_config_updated_at();

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_config' AND policyname='system_config_service_only') THEN
    CREATE POLICY system_config_service_only ON system_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO system_config (key, value)
VALUES ('cost', '{"monthly_ceiling_usd": 200, "alert_at_pct": 70, "halt_at_pct": 100}')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0076: Layer 5 — competitor_accounts, competitor_snapshots, competitor_alerts
-- ─────────────────────────────────────────────────────────────────────────────

-- set_updated_at() function (may already exist from earlier migrations)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN new.updated_at = now(); RETURN new; END;
$$;

CREATE TABLE IF NOT EXISTS public.competitor_accounts (
  competitor_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE,
  handle_instagram  text,
  handle_tiktok     text,
  handle_snapchat   text,
  handle_youtube    text,
  handle_x          text,
  display_name      text,
  sector            text,
  tier              text DEFAULT 'light',
  is_active         boolean NOT NULL DEFAULT true,
  added_at          timestamptz NOT NULL DEFAULT now(),
  last_extracted_at timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_accounts_brand  ON public.competitor_accounts(brand_id);
CREATE INDEX IF NOT EXISTS idx_competitor_accounts_active ON public.competitor_accounts(brand_id, is_active);

CREATE TABLE IF NOT EXISTS public.competitor_snapshots (
  snapshot_id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id                 uuid NOT NULL REFERENCES public.competitor_accounts(competitor_id) ON DELETE CASCADE,
  brand_id                      uuid NOT NULL REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE,
  snapshot_type                 text NOT NULL DEFAULT 'light',
  extracted_at                  timestamptz NOT NULL DEFAULT now(),
  posting_frequency_per_week    numeric(5,2),
  best_posting_days             text[],
  best_posting_hours            int[],
  platforms_active              text[],
  follower_counts               jsonb,
  content_category_distribution jsonb,
  estimated_engagement_rate     numeric(5,4),
  occasion_approach             jsonb,
  top_performing_content_types  text[],
  top_performing_tones          text[],
  caption_style_observed        text,
  visual_style_observed         text,
  cultural_tensions_used        text[],
  gaps_identified               text[],
  threats_identified            text[],
  raw_payload                   jsonb,
  normalised                    jsonb,
  engagement_by_content_type    jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_competitor ON public.competitor_snapshots(competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_brand      ON public.competitor_snapshots(brand_id);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_extracted  ON public.competitor_snapshots(brand_id, extracted_at DESC);

CREATE TABLE IF NOT EXISTS public.competitor_alerts (
  alert_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                    uuid NOT NULL REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE,
  competitor_id               uuid REFERENCES public.competitor_accounts(competitor_id) ON DELETE SET NULL,
  alert_type                  text NOT NULL,
  severity                    text NOT NULL DEFAULT 'info',
  title                       text NOT NULL,
  body                        text NOT NULL,
  suggested_content_direction text,
  is_read                     boolean NOT NULL DEFAULT false,
  is_actioned                 boolean NOT NULL DEFAULT false,
  actioned_at                 timestamptz,
  client_decision             text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_alerts_brand  ON public.competitor_alerts(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_alerts_unread ON public.competitor_alerts(brand_id, is_read) WHERE is_read = false;

ALTER TABLE public.competitor_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_alerts    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_accounts' AND policyname='owner_rw_competitor_accounts') THEN
    CREATE POLICY owner_rw_competitor_accounts ON public.competitor_accounts FOR ALL
      USING (brand_id IN (SELECT brand_id FROM public.brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_accounts' AND policyname='service_role_all_competitor_accounts') THEN
    CREATE POLICY service_role_all_competitor_accounts ON public.competitor_accounts FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_snapshots' AND policyname='owner_rw_competitor_snapshots') THEN
    CREATE POLICY owner_rw_competitor_snapshots ON public.competitor_snapshots FOR ALL
      USING (brand_id IN (SELECT brand_id FROM public.brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_snapshots' AND policyname='service_role_all_competitor_snapshots') THEN
    CREATE POLICY service_role_all_competitor_snapshots ON public.competitor_snapshots FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_alerts' AND policyname='owner_rw_competitor_alerts') THEN
    CREATE POLICY owner_rw_competitor_alerts ON public.competitor_alerts FOR ALL
      USING (brand_id IN (SELECT brand_id FROM public.brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='competitor_alerts' AND policyname='service_role_all_competitor_alerts') THEN
    CREATE POLICY service_role_all_competitor_alerts ON public.competitor_alerts FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_competitor_accounts_updated_at ON public.competitor_accounts;
CREATE TRIGGER trg_competitor_accounts_updated_at
  BEFORE UPDATE ON public.competitor_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 0077: Layer 3 — asset_library + LoRA columns on brand_profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_library (
  asset_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                uuid NOT NULL REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE,
  storage_url             text NOT NULL,
  file_name               text NOT NULL,
  mime_type               text NOT NULL,
  file_size_bytes         bigint,
  asset_type              text NOT NULL DEFAULT 'brand_asset',
  is_approved             boolean,
  approved_at             timestamptz,
  rejected_at             timestamptz,
  rejection_reason        text,
  dominant_colors         text[],
  visual_style_tags       text[],
  detected_objects        text[],
  used_in_posts           text[],
  lora_training_candidate boolean DEFAULT false,
  source                  text NOT NULL DEFAULT 'client_upload',
  uploaded_at             timestamptz NOT NULL DEFAULT now(),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_library_brand    ON public.asset_library(brand_id);
CREATE INDEX IF NOT EXISTS idx_asset_library_type     ON public.asset_library(brand_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_asset_library_approved ON public.asset_library(brand_id, is_approved);
CREATE INDEX IF NOT EXISTS idx_asset_library_lora     ON public.asset_library(brand_id, lora_training_candidate) WHERE lora_training_candidate = true;

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS lora_model_id               text,
  ADD COLUMN IF NOT EXISTS lora_trained_at             timestamptz,
  ADD COLUMN IF NOT EXISTS lora_training_status        text DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS lora_approved_content_types text[],
  ADD COLUMN IF NOT EXISTS lora_training_photo_count   int DEFAULT 0;

ALTER TABLE public.asset_library ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='asset_library' AND policyname='owner_rw_asset_library') THEN
    CREATE POLICY owner_rw_asset_library ON public.asset_library FOR ALL
      USING (brand_id IN (SELECT brand_id FROM public.brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='asset_library' AND policyname='service_role_all_asset_library') THEN
    CREATE POLICY service_role_all_asset_library ON public.asset_library FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_asset_library_updated_at ON public.asset_library;
CREATE TRIGGER trg_asset_library_updated_at
  BEFORE UPDATE ON public.asset_library FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 0078: Layer 6 — brand_content_patterns + 7th formula + calibration fields
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_content_patterns (
  pattern_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id             uuid NOT NULL REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE,
  pattern_type         text NOT NULL,
  content_type         text NOT NULL,
  chain_family         text,
  formula_used         text,
  register_used        text,
  occasion             text,
  trigger_signal       text NOT NULL,
  avg_engagement_rate  numeric(7,4),
  sample_count         int NOT NULL DEFAULT 1,
  confidence           numeric(4,3) DEFAULT 0.5,
  content_mix_shift    jsonb,
  is_active            boolean NOT NULL DEFAULT true,
  invalidated_at       timestamptz,
  invalidation_reason  text,
  first_observed_at    timestamptz NOT NULL DEFAULT now(),
  last_updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_content_patterns_brand  ON public.brand_content_patterns(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_content_patterns_type   ON public.brand_content_patterns(brand_id, pattern_type);
CREATE INDEX IF NOT EXISTS idx_brand_content_patterns_active ON public.brand_content_patterns(brand_id, is_active) WHERE is_active = true;

-- 7th creative formula: add to enum first, then insert
ALTER TYPE creative_method_type ADD VALUE IF NOT EXISTS 'number_reframe';

INSERT INTO public.creative_methods (method, description, coverage_pct, archetypes_served, novel_pattern)
VALUES (
  'number_reframe',
  'Makes data emotionally true. Takes a statistic, measurement, or quantity and reframes it so the human meaning lands before the logic does. Example: Not 3 years. 1,095 mornings of getting it right.',
  0,
  ARRAY['Creator','Sage','Ruler']::archetype_type[],
  true
) ON CONFLICT (method) DO NOTHING;

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS is_calibration_period    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS calibration_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_ends_at      timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_ended_reason text;

CREATE OR REPLACE FUNCTION public.start_calibration_period()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cal_count int;
BEGIN
  SELECT count(*) INTO cal_count FROM public.calendars WHERE brand_id = new.brand_id;
  IF cal_count = 1 THEN
    UPDATE public.brand_profiles
    SET calibration_started_at = now(), calibration_ends_at = now() + interval '90 days', is_calibration_period = true
    WHERE brand_id = new.brand_id AND calibration_started_at IS NULL;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_start_calibration ON public.calendars;
CREATE TRIGGER trg_start_calibration
  AFTER INSERT ON public.calendars FOR EACH ROW EXECUTE FUNCTION public.start_calibration_period();

CREATE OR REPLACE VIEW public.v_calibration_status AS
SELECT bp.brand_id, bp.is_calibration_period, bp.calibration_started_at, bp.calibration_ends_at,
  CASE WHEN bp.calibration_ends_at IS NULL THEN false WHEN now() > bp.calibration_ends_at THEN true ELSE false END AS is_elapsed,
  CASE WHEN bp.calibration_ends_at IS NULL THEN null ELSE greatest(0, EXTRACT(day FROM (bp.calibration_ends_at - now())))::int END AS days_remaining
FROM public.brand_profiles bp;

ALTER TABLE public.brand_content_patterns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_content_patterns' AND policyname='owner_rw_brand_content_patterns') THEN
    CREATE POLICY owner_rw_brand_content_patterns ON public.brand_content_patterns FOR ALL
      USING (brand_id IN (SELECT brand_id FROM public.brand_profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_content_patterns' AND policyname='service_role_all_brand_content_patterns') THEN
    CREATE POLICY service_role_all_brand_content_patterns ON public.brand_content_patterns FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0079: Seed 10 hard-block violations into global_negative_patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- global_negative_patterns uses: pattern_id, pattern_text, severity, category, description, is_active
-- Seed 10 hard blocks using actual column schema
INSERT INTO public.global_negative_patterns (pattern_text, severity, category, description, is_active)
VALUES
  ('Left hand serving food or beverages to another person','HARD_BLOCK','cultural_violation','Spec §11.1 — Saudi cultural violation. Left hand is considered impure for serving.',true),
  ('Left hand used for formal object exchange (gifts, documents, business cards)','HARD_BLOCK','cultural_violation','Spec §11.1 — Formal exchanges must use the right hand in Saudi cultural context.',true),
  ('Sole of foot pointed directly at a person','HARD_BLOCK','cultural_violation','Spec §11.1 — Highly offensive gesture in Saudi/Arab culture.',true),
  ('Palm-up beckoning gesture directed at a person','HARD_BLOCK','cultural_violation','Spec §11.1 — Considered rude or demeaning in Saudi context.',true),
  ('Physical contact between non-mahrams in traditional-register content','HARD_BLOCK','cultural_violation','Spec §11.1 — Only applies to traditional/conservative register brands.',true),
  ('Food or beverage being consumed during Ramadan daylight hours','HARD_BLOCK','seasonal_violation','Spec §11.1 — Seasonal violation active when Ramadan occasion flag is set.',true),
  ('Quran placed under other objects or handled disrespectfully','HARD_BLOCK','religious_violation','Spec §11.1 — Absolute violation with potential legal implications in KSA.',true),
  ('Index finger pointing directly at a person','HARD_BLOCK','cultural_violation','Spec §11.1 — Considered aggressive and disrespectful in Saudi/Arab context.',true),
  ('Western side-to-side head shake to indicate refusal or disagreement','HARD_BLOCK','cultural_violation','Spec §11.1 — In Saudi context, the upward chin tilt means no.',true),
  ('Counting gesture starting at the index finger (Western style) instead of the thumb','HARD_BLOCK','cultural_violation','Spec §11.1 — Saudi/Arab counting starts with the thumb.',true)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.v_hard_block_violations AS
SELECT pattern_id, pattern_text, severity, category, description
FROM public.global_negative_patterns
WHERE severity = 'HARD_BLOCK' AND is_active = true
ORDER BY pattern_text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0080: C2PA watermark columns on calendar_posts
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS c2pa_signed       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_generated      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS generation_model  text,
  ADD COLUMN IF NOT EXISTS c2pa_metadata     jsonb;

CREATE INDEX IF NOT EXISTS idx_calendar_posts_c2pa
  ON public.calendar_posts(brand_id, c2pa_signed)
  WHERE ai_generated = true AND c2pa_signed = false;

CREATE OR REPLACE VIEW public.v_c2pa_compliance AS
SELECT
  count(*)                                          AS total_ai_posts,
  count(*) FILTER (WHERE c2pa_signed = true)        AS c2pa_signed_count,
  count(*) FILTER (WHERE c2pa_signed = false)       AS c2pa_pending_count,
  ROUND(100.0 * count(*) FILTER (WHERE c2pa_signed = true) / NULLIF(count(*),0), 1) AS compliance_pct
FROM public.calendar_posts WHERE ai_generated = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0081: BrandDNA schema cleanup — drop stale columns, add products_list
-- ─────────────────────────────────────────────────────────────────────────────

-- Copy lifecycle_stage → lifecycle before dropping
UPDATE public.brand_profiles
  SET lifecycle = lifecycle_stage::text
  WHERE lifecycle IS NULL AND lifecycle_stage IS NOT NULL;

ALTER TABLE public.brand_profiles DROP COLUMN IF EXISTS lifecycle_stage;

DO $$ BEGIN
  DROP TYPE IF EXISTS lifecycle_stage_type;
EXCEPTION WHEN others THEN NULL; END $$;

-- archetype_secondary intentionally NOT dropped — used by COO compile-caption-context and Memory Controller
ALTER TABLE public.brand_profiles DROP COLUMN IF EXISTS business_events;

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS products_list text NULL;

COMMENT ON COLUMN public.brand_profiles.audience_gender_mix IS
  'Denorm cache of audience_profiles.gender_mix — written by submitFinal, updated by Memory Controller';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0082: Add normalised column to competitor_snapshots (already included in 0076 above)
-- ─────────────────────────────────────────────────────────────────────────────
-- normalised column already added in 0076 table creation above (idempotent)

-- ─────────────────────────────────────────────────────────────────────────────
-- 0083: Fix axis enum values — already applied via old migrations, skip enum rename
-- Just ensure the columns exist with correct types
-- ─────────────────────────────────────────────────────────────────────────────

-- Add columns if missing (safe no-op if they already exist with correct enum type)
ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS lifecycle_stage lifecycle_stage_type,
  ADD COLUMN IF NOT EXISTS intent_state    intent_state_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0084: Update completeness function to 12 fields
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_brand_completeness(p_brand_id uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  WITH critical AS (
    SELECT unnest(ARRAY[
      'arabic_dialect','brand_differentiator','price_position','primary_channel',
      'ramadan_relevance','primary_audience_gender','primary_kpi_type',
      'religious_sensitivity','tone_anti_attribute_ids','bilingual_ratio',
      'archetype_primary','lifecycle_stage'
    ]) AS field_name
  ),
  qualified AS (
    SELECT DISTINCT eb.field_name
    FROM evidence_bundles eb
    JOIN critical c ON c.field_name = eb.field_name
    WHERE eb.brand_id = p_brand_id
      AND eb.field_confidence::text IN ('inferred_medium','inferred_high','explicitly_confirmed')
  )
  SELECT greatest(0, least(100, ((count(*)::float / 12.0) * 100)::int)) FROM qualified
$$;

CREATE OR REPLACE FUNCTION public.refresh_brand_completeness(p_brand_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_score int;
BEGIN
  SELECT public.compute_brand_completeness(p_brand_id) INTO v_score;
  UPDATE public.brand_profiles SET completeness_score = v_score, updated_at = now() WHERE brand_id = p_brand_id;
  RETURN v_score;
END
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT brand_id FROM public.brand_profiles LOOP
    PERFORM public.refresh_brand_completeness(r.brand_id);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0085: Seed sector_baselines (superseded by 0091 — skip, 0091 uses correct conflict key)
-- ─────────────────────────────────────────────────────────────────────────────
-- (Skipped — 0091 below correctly seeds all sectors with dialect='MSA_accessible')

-- ─────────────────────────────────────────────────────────────────────────────
-- 0086: Layer 3 — style_register enum + visual_style_profiles columns
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE style_register_type AS ENUM ('traditional','modern','youth','mixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.visual_style_profiles
  ADD COLUMN IF NOT EXISTS style_register style_register_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0087: Strategy version trigger → strategy_updates_log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.on_strategy_version_increment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF new.strategy_version IS NOT NULL
     AND (old.strategy_version IS NULL OR new.strategy_version > old.strategy_version)
  THEN
    INSERT INTO public.strategy_updates_log (
      brand_id, strategy_version, changed_fields, change_summary,
      trigger_type, triggered_by, client_notified, created_at
    ) VALUES (
      new.brand_id, new.strategy_version,
      array_remove(ARRAY[
        CASE WHEN old.permission_level          IS DISTINCT FROM new.permission_level          THEN 'permission_level'          END,
        CASE WHEN old.cultural_tension_owned    IS DISTINCT FROM new.cultural_tension_owned    THEN 'cultural_tension_owned'    END,
        CASE WHEN old.content_mix_ratios        IS DISTINCT FROM new.content_mix_ratios        THEN 'content_mix_ratios'        END,
        CASE WHEN old.platform_weights          IS DISTINCT FROM new.platform_weights          THEN 'platform_weights'          END,
        CASE WHEN old.goal_phase                IS DISTINCT FROM new.goal_phase                THEN 'goal_phase'                END,
        CASE WHEN old.occasion_approach         IS DISTINCT FROM new.occasion_approach         THEN 'occasion_approach'         END,
        CASE WHEN old.brave_safe_default        IS DISTINCT FROM new.brave_safe_default        THEN 'brave_safe_default'        END,
        CASE WHEN old.archetype_primary         IS DISTINCT FROM new.archetype_primary         THEN 'archetype_primary'         END,
        CASE WHEN old.lifecycle_stage           IS DISTINCT FROM new.lifecycle_stage           THEN 'lifecycle_stage'           END,
        CASE WHEN old.intent_state              IS DISTINCT FROM new.intent_state              THEN 'intent_state'              END
      ], null),
      'Strategy updated to v' || new.strategy_version::text,
      'strategy_version_increment', 'system', false, now()
    );
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_strategy_version_increment ON public.brand_profiles;
CREATE TRIGGER trg_strategy_version_increment
  AFTER UPDATE OF strategy_version ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.on_strategy_version_increment();

CREATE INDEX IF NOT EXISTS idx_strategy_updates_log_unsent
  ON public.strategy_updates_log(brand_id, created_at DESC)
  WHERE client_notified = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0088: Consolidate LoRA — drop redundant columns from visual_style_profiles
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.visual_style_profiles
  DROP COLUMN IF EXISTS lora_reference,
  DROP COLUMN IF EXISTS approved_examples,
  DROP COLUMN IF EXISTS rejected_examples;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0089: competitor_snapshots — occasion_approach + engagement_by_content_type
--       (already included in 0076 CREATE TABLE above — idempotent via ADD COLUMN IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.competitor_snapshots
  ADD COLUMN IF NOT EXISTS occasion_approach          jsonb,
  ADD COLUMN IF NOT EXISTS engagement_by_content_type jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0090: Calibration trigger on onboarding_status = 'complete'
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.on_onboarding_complete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF new.onboarding_status = 'complete'
     AND (old.onboarding_status IS NULL OR old.onboarding_status != 'complete')
     AND new.calibration_started_at IS NULL
  THEN
    UPDATE public.brand_profiles
    SET is_calibration_period  = true,
        calibration_started_at = now(),
        calibration_ends_at    = now() + interval '90 days'
    WHERE brand_id = new.brand_id;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_complete_calibration ON public.brand_profiles;
CREATE TRIGGER trg_onboarding_complete_calibration
  AFTER UPDATE OF onboarding_status ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION public.on_onboarding_complete();

UPDATE public.brand_profiles
SET is_calibration_period  = true,
    calibration_started_at = updated_at,
    calibration_ends_at    = updated_at + interval '90 days'
WHERE onboarding_status = 'complete' AND calibration_started_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0091: Fix sector_baselines seed with correct (sector, dialect) conflict key
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.sector_baselines (sector, dialect, recommended_content_mix, top_performing_tones, worst_performing_tones, occasion_insights, confidence_benchmarks, last_updated)
VALUES
('F&B','MSA_accessible',
  '{"product":35,"lifestyle":25,"occasion":25,"behind_scenes":15}',
  '["warm_inviting","sensory_description","community_gathering","nostalgic_heritage"]',
  '["corporate_formal","aggressive_promotional","western_casual"]',
  '{"Ramadan":{"weight":0.35,"content_shift":"gathering_warmth","post_frequency_multiplier":1.5},"Eid_Fitr":{"weight":0.20,"content_shift":"celebration_gift","post_frequency_multiplier":1.3},"National_Day":{"weight":0.15,"content_shift":"saudi_pride_local","post_frequency_multiplier":1.2}}',
  '{"avg_engagement_rate":0.038,"avg_posting_frequency_week":4.5,"benchmark_likes_per_1k_followers":42}',
  now()),
('Retail','MSA_accessible',
  '{"product":40,"lifestyle":30,"occasion":20,"behind_scenes":10}',
  '["aspirational_accessible","value_clarity","trend_aware","local_pride"]',
  '["overly_formal","generic_global","pushy_salesy"]',
  '{"Ramadan":{"weight":0.30,"content_shift":"gift_giving_family","post_frequency_multiplier":1.6},"Eid_Fitr":{"weight":0.25,"content_shift":"new_clothes_celebration","post_frequency_multiplier":1.4},"National_Day":{"weight":0.15,"content_shift":"local_pride_collection","post_frequency_multiplier":1.2}}',
  '{"avg_engagement_rate":0.032,"avg_posting_frequency_week":5.0,"benchmark_likes_per_1k_followers":36}',
  now()),
('Beauty_Wellness','MSA_accessible',
  '{"product":30,"lifestyle":35,"occasion":15,"behind_scenes":20}',
  '["aspirational_achievable","self_care_permission","transformation_narrative","intimate_honest"]',
  '["aggressive_claims","western_casual_ironic","flashy_loud"]',
  '{"Ramadan":{"weight":0.20,"content_shift":"self_care_spiritual","post_frequency_multiplier":1.2},"Eid_Fitr":{"weight":0.20,"content_shift":"celebration_glow","post_frequency_multiplier":1.3}}',
  '{"avg_engagement_rate":0.045,"avg_posting_frequency_week":6.0,"benchmark_likes_per_1k_followers":55}',
  now()),
('Healthcare','MSA_accessible',
  '{"product":20,"lifestyle":25,"occasion":15,"behind_scenes":40}',
  '["trusted_authoritative","empathetic_warm","educational_clear","community_reassuring"]',
  '["fear_based","overpromising","casual_humor","ironic"]',
  '{"Ramadan":{"weight":0.25,"content_shift":"health_during_fasting","post_frequency_multiplier":1.3}}',
  '{"avg_engagement_rate":0.028,"avg_posting_frequency_week":3.5,"benchmark_likes_per_1k_followers":28}',
  now()),
('Finance','MSA_accessible',
  '{"product":25,"lifestyle":20,"occasion":15,"behind_scenes":40}',
  '["trusted_precise","empowering_clear","educational_accessible","authoritative_warm"]',
  '["flashy_loud","casual_humor","aggressive_promotional","western_casual"]',
  '{"Ramadan":{"weight":0.20,"content_shift":"savings_zakat_guidance","post_frequency_multiplier":1.2}}',
  '{"avg_engagement_rate":0.022,"avg_posting_frequency_week":3.0,"benchmark_likes_per_1k_followers":22}',
  now()),
('Government','MSA_accessible',
  '{"product":15,"lifestyle":20,"occasion":35,"behind_scenes":30}',
  '["authoritative_accessible","proud_inclusive","clear_direct","community_service"]',
  '["casual_humor","ironic","edgy","western_casual"]',
  '{"National_Day":{"weight":0.40,"content_shift":"national_pride_achievement","post_frequency_multiplier":2.0},"Founding_Day":{"weight":0.30,"content_shift":"heritage_vision_2030","post_frequency_multiplier":1.8}}',
  '{"avg_engagement_rate":0.035,"avg_posting_frequency_week":4.0,"benchmark_likes_per_1k_followers":38}',
  now()),
('Other','MSA_accessible',
  '{"product":30,"lifestyle":30,"occasion":20,"behind_scenes":20}',
  '["authentic_honest","clear_direct","community_warm"]',
  '["aggressive_promotional","generic_global","corporate_formal"]',
  '{"Ramadan":{"weight":0.25,"content_shift":"community_gathering","post_frequency_multiplier":1.3},"National_Day":{"weight":0.20,"content_shift":"local_pride","post_frequency_multiplier":1.2}}',
  '{"avg_engagement_rate":0.030,"avg_posting_frequency_week":3.5,"benchmark_likes_per_1k_followers":32}',
  now())
ON CONFLICT (sector, dialect) DO UPDATE SET
  recommended_content_mix = excluded.recommended_content_mix,
  top_performing_tones    = excluded.top_performing_tones,
  worst_performing_tones  = excluded.worst_performing_tones,
  occasion_insights       = excluded.occasion_insights,
  confidence_benchmarks   = excluded.confidence_benchmarks,
  last_updated            = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 0092: Calendar slot generator columns on calendar_posts
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS scheduled_date        DATE,
  ADD COLUMN IF NOT EXISTS channel               channel_type,
  ADD COLUMN IF NOT EXISTS format                TEXT,
  ADD COLUMN IF NOT EXISTS chain_id              TEXT REFERENCES public.chains(chain_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS strategic_rationale   TEXT,
  ADD COLUMN IF NOT EXISTS occasion_flags        TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_calendar_posts_brand_date ON public.calendar_posts(brand_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_calendar_posts_pending    ON public.calendar_posts(brand_id, status, scheduled_date) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 0093: Phase 4 — brand_performance_log, knowledge_corpus, learning_cycles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brand_performance_log (
  log_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  post_id          UUID REFERENCES calendar_posts(post_id) ON DELETE SET NULL,
  platform_post_id TEXT,
  channel          TEXT NOT NULL,
  posted_at        TIMESTAMPTZ,
  content_type     TEXT,
  chain_id         TEXT,
  creative_formula TEXT,
  reach            INTEGER DEFAULT 0,
  impressions      INTEGER DEFAULT 0,
  likes            INTEGER DEFAULT 0,
  comments         INTEGER DEFAULT 0,
  shares           INTEGER DEFAULT 0,
  saves            INTEGER DEFAULT 0,
  engagement_rate  NUMERIC(6,4) DEFAULT 0,
  brand_score      NUMERIC(5,2),
  sector_score     NUMERIC(5,2),
  platform_score   NUMERIC(5,2),
  caption_variant  TEXT,
  chain_approved   BOOLEAN DEFAULT FALSE,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(brand_id, platform_post_id)
);

-- Indexes only created if posted_at column exists (table may have different schema)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_performance_log' AND column_name='posted_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_perf_log_brand_date ON brand_performance_log(brand_id, posted_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_performance_log' AND column_name='chain_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_perf_log_chain ON brand_performance_log(brand_id, chain_id) WHERE chain_id IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brand_performance_log' AND column_name='creative_formula') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_perf_log_formula ON brand_performance_log(brand_id, creative_formula) WHERE creative_formula IS NOT NULL';
  END IF;
END $$;

ALTER TABLE brand_performance_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_performance_log' AND policyname='brand_perf_log_owner_read') THEN
    CREATE POLICY brand_perf_log_owner_read ON brand_performance_log FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.brand_profiles WHERE brand_profiles.brand_id = brand_performance_log.brand_id AND brand_profiles.auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brand_performance_log' AND policyname='brand_perf_log_service_insert') THEN
    CREATE POLICY brand_perf_log_service_insert ON brand_performance_log FOR INSERT WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE brand_content_patterns
  ADD COLUMN IF NOT EXISTS chain_id         TEXT,
  ADD COLUMN IF NOT EXISTS creative_formula TEXT,
  ADD COLUMN IF NOT EXISTS content_type     TEXT,
  ADD COLUMN IF NOT EXISTS avg_score        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sample_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_winner        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS period_start     DATE,
  ADD COLUMN IF NOT EXISTS period_end       DATE,
  ADD COLUMN IF NOT EXISTS insight          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_content_patterns_brand_chain_period') THEN
    ALTER TABLE brand_content_patterns
      ADD CONSTRAINT brand_content_patterns_brand_chain_period UNIQUE (brand_id, chain_id, period_start);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_corpus (
  corpus_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key  TEXT NOT NULL,
  sector       TEXT NOT NULL,
  dialect      TEXT NOT NULL DEFAULT 'MSA_accessible',
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('gold','anti','neutral')),
  description  TEXT NOT NULL,
  chain_id     TEXT,
  formula      TEXT,
  content_type TEXT,
  confidence   NUMERIC(3,2) NOT NULL DEFAULT 0.70 CHECK (confidence BETWEEN 0 AND 1),
  source       TEXT DEFAULT 'knowledge_extraction',
  sample_count INTEGER DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pattern_key, sector, dialect)
);

CREATE INDEX IF NOT EXISTS idx_corpus_sector ON knowledge_corpus(sector, dialect);
CREATE INDEX IF NOT EXISTS idx_corpus_type   ON knowledge_corpus(pattern_type, confidence DESC);

ALTER TABLE knowledge_corpus ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='knowledge_corpus' AND policyname='corpus_service_all') THEN
    CREATE POLICY corpus_service_all ON knowledge_corpus USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS learning_cycles (
  cycle_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  posts_analysed   INTEGER DEFAULT 0,
  patterns_found   INTEGER DEFAULT 0,
  winners_count    INTEGER DEFAULT 0,
  losers_count     INTEGER DEFAULT 0,
  nominations_sent INTEGER DEFAULT 0,
  cost_usd         NUMERIC(10,6) DEFAULT 0,
  status           TEXT DEFAULT 'complete' CHECK (status IN ('running','complete','failed')),
  ran_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_cycles_brand ON learning_cycles(brand_id, ran_at DESC);

ALTER TABLE learning_cycles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='learning_cycles' AND policyname='learning_cycles_owner_read') THEN
    CREATE POLICY learning_cycles_owner_read ON learning_cycles FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.brand_profiles WHERE brand_profiles.brand_id = learning_cycles.brand_id AND brand_profiles.auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='learning_cycles' AND policyname='learning_cycles_service_insert') THEN
    CREATE POLICY learning_cycles_service_insert ON learning_cycles FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0094: Instagram analytics columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS followers_count            INTEGER,
  ADD COLUMN IF NOT EXISTS ig_post_count              INTEGER,
  ADD COLUMN IF NOT EXISTS ig_verified                BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS account_type               TEXT,
  ADD COLUMN IF NOT EXISTS bio_text                   TEXT,
  ADD COLUMN IF NOT EXISTS bio_link                   TEXT,
  ADD COLUMN IF NOT EXISTS avg_engagement_rate        NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS posting_frequency_per_week NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS primary_content_format     TEXT,
  ADD COLUMN IF NOT EXISTS content_type_distribution  JSONB,
  ADD COLUMN IF NOT EXISTS caption_avg_length         INTEGER,
  ADD COLUMN IF NOT EXISTS top_hashtags               TEXT[],
  ADD COLUMN IF NOT EXISTS top_mentioned_accounts     TEXT[];

ALTER TABLE public.audience_profiles
  ADD COLUMN IF NOT EXISTS audience_location_primary    TEXT,
  ADD COLUMN IF NOT EXISTS audience_age_range_estimated TEXT,
  ADD COLUMN IF NOT EXISTS follower_quality_signal      TEXT;

ALTER TABLE public.visual_style_profiles
  ADD COLUMN IF NOT EXISTS avg_video_duration_secs INTEGER,
  ADD COLUMN IF NOT EXISTS aspect_ratio_primary    TEXT,
  ADD COLUMN IF NOT EXISTS filter_style            TEXT,
  ADD COLUMN IF NOT EXISTS has_arabic_overlay      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_logo_watermark      BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_brand_followers      ON public.brand_profiles(followers_count DESC)       WHERE followers_count IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_engagement     ON public.brand_profiles(avg_engagement_rate DESC)   WHERE avg_engagement_rate IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_content_format ON public.brand_profiles(primary_content_format)     WHERE primary_content_format IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE — all 21 migrations applied (0074 → 0094)
-- After running: execute  SELECT pnpm db:types  to regenerate TypeScript types
-- ═══════════════════════════════════════════════════════════════════════════════
