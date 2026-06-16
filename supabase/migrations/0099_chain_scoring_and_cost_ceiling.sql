-- ─────────────────────────────────────────────────────────────────────────────
-- 0099_chain_scoring_and_cost_ceiling.sql
--
-- Implements Doc §9.5 full-fidelity chain scoring + §9.2 Budget Enforcer.
--
-- Changes:
--   1. chains table: add style_affinity + platform_tags columns
--   2. View: brand_chain_approval_rate  — per-brand per-chain approval rate
--      computed on-the-fly from usage_logs (Learning Agent replaces with
--      weekly-precomputed values in Phase 4; the view is the fallback).
--   3. View: chain_platform_approval_rate — platform-wide approval per chain
--   4. Trigger fn: fn_cost_ceiling_enforcer — fires AFTER INSERT on usage_logs;
--      updates brand_cost_config.current_month_cost_usd (added here) and
--      inserts into anomaly_records when a ceiling threshold is crossed.
--   5. brand_cost_config: add current_month_cost_usd + cost_blocked columns
--      so n8n can read a single row rather than summing usage_logs every call.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. chains: style_affinity + platform_tags ─────────────────────────────────
--
-- style_affinity: maps to the brand's visual_style_profiles.style_register enum.
-- Possible values mirror style_register_type: traditional | modern | youth | mixed.
-- NULL = chain is register-agnostic (matches any style).
--
-- platform_tags: which social platforms this chain is designed for.
-- Used in the platform-match filter (§9.5 step 1).
-- NULL = eligible on all platforms.

ALTER TABLE chains
  ADD COLUMN IF NOT EXISTS style_affinity TEXT
    CHECK (style_affinity IN ('traditional', 'modern', 'youth', 'mixed')),
  ADD COLUMN IF NOT EXISTS platform_tags  TEXT[];

COMMENT ON COLUMN chains.style_affinity IS
  'Visual style register this chain is optimised for. NULL = all registers.';
COMMENT ON COLUMN chains.platform_tags IS
  'Social platforms this chain is designed for (instagram, snapchat, tiktok, …). NULL = all platforms.';

-- Index for platform filter (GIN, same pattern as eligible_sectors)
CREATE INDEX IF NOT EXISTS idx_chains_platform_tags
  ON chains USING GIN (platform_tags);

-- ── 2. Seed style_affinity defaults for existing chains ───────────────────────
-- TF07/08/09/18 → traditional, TF10-13/22 → modern/youth, rest → NULL (all).
-- These are reasonable defaults; the Learning Agent refines them from
-- performance data (Phase 4). Admin can override per-chain in the chains table.

UPDATE chains SET style_affinity = 'traditional'
  WHERE family IN ('TF07','TF08','TF09','TF18') AND style_affinity IS NULL;

UPDATE chains SET style_affinity = 'modern'
  WHERE family IN ('TF10','TF11','TF12','TF13','TF22') AND style_affinity IS NULL;

UPDATE chains SET style_affinity = 'youth'
  WHERE family IN ('TF23') AND style_affinity IS NULL;

-- ── 3. brand_cost_config: fast-read cost columns ──────────────────────────────
--
-- current_month_cost_usd is maintained by fn_cost_ceiling_enforcer (below).
-- cost_blocked is set TRUE when halt_at_pct is crossed; cleared by the
-- admin "unblock" action or automatically on the 1st of a new month.
-- last_reset_month records which calendar month the rolling total was last reset.

ALTER TABLE brand_cost_config
  ADD COLUMN IF NOT EXISTS current_month_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_blocked            BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_reset_month        TEXT; -- 'YYYY-MM' e.g. '2026-06'

COMMENT ON COLUMN brand_cost_config.current_month_cost_usd IS
  'Running sum of usage_logs.cost_usd for the current calendar month. Updated by fn_cost_ceiling_enforcer.';
COMMENT ON COLUMN brand_cost_config.cost_blocked IS
  'TRUE when this brand has exceeded halt_at_pct of monthly_ceiling_usd. n8n skips generation when TRUE.';
COMMENT ON COLUMN brand_cost_config.last_reset_month IS
  'The YYYY-MM month when current_month_cost_usd was last reset to 0. Used to detect month rollover.';

-- ── 4. View: brand_chain_approval_rate ───────────────────────────────────────
--
-- Per-brand per-chain approval rate derived from usage_logs.
-- A row in usage_logs is counted as "approved" when:
--   status = 'success'  AND  agent = 'image'  AND  chain_id IS NOT NULL
-- (image generation rows store chain_id in the payload JSONB; we extract it).
--
-- "Approved" in §9.5 means the generated post was not held by the confidence
-- gate. We approximate this by: rows where cost_usd > 0 AND no error_code.
--
-- NOTE: usage_logs does NOT have a chain_id column today. The chain_id is
-- embedded in the `payload` JSONB as payload->>'chain_id'. This view extracts
-- it. The Learning Agent (Phase 4) pre-computes and stores this in a dedicated
-- table; this view is the live fallback.

CREATE OR REPLACE VIEW brand_chain_approval_rate AS
SELECT
  ul.brand_id,
  ul.payload->>'chain_id'                     AS chain_id,
  COUNT(*)                                     AS total_generations,
  COUNT(*) FILTER (
    WHERE ul.status = 'success'
      AND ul.error_code IS NULL
      AND ul.cost_usd > 0
  )                                            AS approved_count,
  ROUND(
    COUNT(*) FILTER (
      WHERE ul.status = 'success'
        AND ul.error_code IS NULL
        AND ul.cost_usd > 0
    )::numeric / NULLIF(COUNT(*), 0) * 100,
    1
  )                                            AS approval_rate_pct,
  -- §9.5 score component: brand historical approval (0-40 pts)
  LEAST(40,
    ROUND(
      COUNT(*) FILTER (
        WHERE ul.status = 'success'
          AND ul.error_code IS NULL
          AND ul.cost_usd > 0
      )::numeric / NULLIF(COUNT(*), 0) * 40,
      1
    )
  )                                            AS brand_approval_score
FROM usage_logs ul
WHERE ul.payload->>'chain_id' IS NOT NULL
  AND ul.created_at >= date_trunc('month', now()) - INTERVAL '3 months'
GROUP BY ul.brand_id, ul.payload->>'chain_id';

GRANT SELECT ON brand_chain_approval_rate TO authenticated, service_role;

-- ── 5. View: chain_platform_approval_rate ────────────────────────────────────
--
-- Platform-wide (cross-brand) approval rate per chain.
-- §9.5 score component: platform approval (0-30 pts).

CREATE OR REPLACE VIEW chain_platform_approval_rate AS
SELECT
  ul.payload->>'chain_id'                     AS chain_id,
  COUNT(DISTINCT ul.brand_id)                 AS brand_count,
  COUNT(*)                                    AS total_generations,
  COUNT(*) FILTER (
    WHERE ul.status = 'success'
      AND ul.error_code IS NULL
      AND ul.cost_usd > 0
  )                                           AS approved_count,
  ROUND(
    COUNT(*) FILTER (
      WHERE ul.status = 'success'
        AND ul.error_code IS NULL
        AND ul.cost_usd > 0
    )::numeric / NULLIF(COUNT(*), 0) * 100,
    1
  )                                           AS approval_rate_pct,
  -- §9.5 score component: platform-wide approval (0-30 pts)
  LEAST(30,
    ROUND(
      COUNT(*) FILTER (
        WHERE ul.status = 'success'
          AND ul.error_code IS NULL
          AND ul.cost_usd > 0
      )::numeric / NULLIF(COUNT(*), 0) * 30,
      1
    )
  )                                           AS platform_approval_score
FROM usage_logs ul
WHERE ul.payload->>'chain_id' IS NOT NULL
  AND ul.created_at >= date_trunc('month', now()) - INTERVAL '6 months'
GROUP BY ul.payload->>'chain_id';

GRANT SELECT ON chain_platform_approval_rate TO authenticated, service_role;

-- ── 6. Cost-ceiling enforcer trigger ─────────────────────────────────────────
--
-- Fires AFTER INSERT on usage_logs for every row where cost_usd > 0.
-- Responsibilities:
--   a) Reset current_month_cost_usd when the calendar month has rolled over.
--   b) Increment current_month_cost_usd by the new cost.
--   c) If the running total crosses a threshold, set cost_blocked = TRUE and
--      insert a row into anomaly_records (picked up by N8N-S03).
--   d) Clear cost_blocked if we're still below halt_at_pct (handles the
--      edge case where admin adjusts the ceiling upward).
--
-- This runs synchronously on INSERT, so n8n sees the updated state
-- on its next v_brand_monthly_spend read.

CREATE OR REPLACE FUNCTION fn_cost_ceiling_enforcer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cfg          brand_cost_config%ROWTYPE;
  v_new_total    NUMERIC(10,6);
  v_spend_pct    NUMERIC(5,1);
  v_current_mon  TEXT;
  v_severity     TEXT;
  v_anomaly_type TEXT;
BEGIN
  -- Only act on rows that carry a real cost and belong to a brand.
  IF NEW.cost_usd IS NULL OR NEW.cost_usd <= 0 OR NEW.brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_current_mon := TO_CHAR(now(), 'YYYY-MM');

  -- Load (or create on-the-fly) the cost config row for this brand.
  SELECT * INTO v_cfg FROM brand_cost_config WHERE brand_id = NEW.brand_id;
  IF NOT FOUND THEN
    -- Auto-seed with defaults (shouldn't happen after migration, but defensive)
    INSERT INTO brand_cost_config (brand_id, last_reset_month)
      VALUES (NEW.brand_id, v_current_mon)
      ON CONFLICT (brand_id) DO NOTHING;
    SELECT * INTO v_cfg FROM brand_cost_config WHERE brand_id = NEW.brand_id;
  END IF;

  -- Month rollover: reset running total when the month changes.
  IF v_cfg.last_reset_month IS DISTINCT FROM v_current_mon THEN
    UPDATE brand_cost_config
      SET current_month_cost_usd = 0,
          cost_blocked            = FALSE,
          last_reset_month        = v_current_mon,
          updated_at              = now()
    WHERE brand_id = NEW.brand_id;
    v_cfg.current_month_cost_usd := 0;
    v_cfg.cost_blocked           := FALSE;
  END IF;

  -- Increment running total.
  v_new_total := COALESCE(v_cfg.current_month_cost_usd, 0) + NEW.cost_usd;
  v_spend_pct := ROUND(v_new_total / NULLIF(v_cfg.monthly_ceiling_usd, 0) * 100, 1);

  -- Determine threshold breach (mirrors v_brand_monthly_spend logic).
  IF v_new_total >= v_cfg.monthly_ceiling_usd THEN
    v_anomaly_type := 'cost_ceiling_breached';
    v_severity     := 'critical';
  ELSIF v_spend_pct >= v_cfg.halt_at_pct THEN
    v_anomaly_type := 'cost_ceiling_halt';
    v_severity     := 'critical';
  ELSIF v_spend_pct >= v_cfg.alert_at_pct THEN
    v_anomaly_type := 'cost_ceiling_approaching';
    v_severity     := 'warning';
  ELSE
    v_anomaly_type := NULL;
    v_severity     := NULL;
  END IF;

  -- Set cost_blocked when halt threshold is crossed.
  UPDATE brand_cost_config
    SET current_month_cost_usd = v_new_total,
        cost_blocked = (v_spend_pct >= v_cfg.halt_at_pct OR v_new_total >= v_cfg.monthly_ceiling_usd),
        updated_at   = now()
  WHERE brand_id = NEW.brand_id;

  -- Insert anomaly record for threshold crossings (§9.2 Budget Enforcer).
  -- Upsert by (brand_id, anomaly_type) so we don't flood the table with
  -- duplicates during a single generation batch.
  IF v_anomaly_type IS NOT NULL THEN
    INSERT INTO anomaly_records (
      brand_id,
      anomaly_type,
      severity,
      source_flow,
      details,
      resolved,
      created_at
    ) VALUES (
      NEW.brand_id,
      v_anomaly_type,
      v_severity,
      COALESCE(NEW.flow_id, 'unknown'),
      jsonb_build_object(
        'current_month_spend_usd', v_new_total,
        'monthly_ceiling_usd',     v_cfg.monthly_ceiling_usd,
        'spend_pct',               v_spend_pct,
        'halt_at_pct',             v_cfg.halt_at_pct,
        'alert_at_pct',            v_cfg.alert_at_pct,
        'triggering_log_id',       NEW.log_id,
        'triggering_flow_id',      NEW.flow_id,
        'triggering_agent',        NEW.agent,
        'detected_at',             now()
      ),
      FALSE,
      now()
    )
    ON CONFLICT (brand_id, anomaly_type) DO UPDATE
      SET severity   = EXCLUDED.severity,
          details    = EXCLUDED.details,
          resolved   = FALSE,
          created_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger (drop first so re-running migration is idempotent)
DROP TRIGGER IF EXISTS trg_cost_ceiling_enforcer ON usage_logs;
CREATE TRIGGER trg_cost_ceiling_enforcer
  AFTER INSERT ON usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_cost_ceiling_enforcer();

-- ── 7. anomaly_records: ensure unique constraint for upsert ──────────────────
-- The ON CONFLICT in the trigger above requires (brand_id, anomaly_type) to be
-- unique. Add the constraint if it does not already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anomaly_records_brand_anomaly_uniq'
  ) THEN
    ALTER TABLE anomaly_records
      ADD CONSTRAINT anomaly_records_brand_anomaly_uniq
      UNIQUE (brand_id, anomaly_type);
  END IF;
END;
$$;

-- ── 8. Chain suspension helper view ──────────────────────────────────────────
-- §9.5 step 5: chains below 40% approval rate should be suspended.
-- The Learning Agent reads this view weekly (Phase 4). For Phase 1-3
-- it is also readable by the admin panel.

CREATE OR REPLACE VIEW v_chain_health AS
SELECT
  c.chain_id,
  c.family,
  c.name_en,
  c.is_active,
  COALESCE(cpar.approval_rate_pct, NULL)  AS platform_approval_rate_pct,
  COALESCE(cpar.brand_count, 0)           AS brand_count,
  COALESCE(cpar.total_generations, 0)     AS total_generations,
  CASE
    WHEN cpar.approval_rate_pct IS NULL                 THEN 'insufficient_data'
    WHEN cpar.approval_rate_pct < 40                    THEN 'suspend'      -- §9.5 < 40% → suspend
    WHEN cpar.approval_rate_pct < 60                    THEN 'review'       -- §9.5 < 60% → flag
    ELSE                                                     'healthy'
  END                                     AS health_status
FROM chains c
LEFT JOIN chain_platform_approval_rate cpar ON cpar.chain_id = c.chain_id;

GRANT SELECT ON v_chain_health TO authenticated, service_role;

-- ── 9. Seed last_reset_month for existing brand_cost_config rows ──────────────
UPDATE brand_cost_config
  SET last_reset_month = TO_CHAR(now(), 'YYYY-MM')
WHERE last_reset_month IS NULL;

-- Back-fill current_month_cost_usd from existing usage_logs rows
-- so the column starts accurate rather than at zero.
UPDATE brand_cost_config bc
  SET current_month_cost_usd = COALESCE((
    SELECT SUM(ul.cost_usd)
    FROM usage_logs ul
    WHERE ul.brand_id  = bc.brand_id
      AND ul.cost_usd  > 0
      AND ul.created_at >= date_trunc('month', now())
      AND ul.status    = 'success'
  ), 0)
WHERE TRUE;
