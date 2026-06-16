-- ─────────────────────────────────────────────────────────────────────────────
-- 0074_cost_monitoring_schema.sql
-- Cost monitoring: extend usage_logs + create brand_cost_config
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend usage_logs ─────────────────────────────────────────────────────

-- Routing / tracing context
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS client_slug   text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS flow_run_id   text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS request_type  text;

-- Model / agent identification
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS model  text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS agent  text;  -- 'CEO' | 'COO' | 'CCO' | 'DeepSeek'

-- Token breakdown (null for image-only calls)
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_in      integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_out     integer;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS tokens_cached  integer;

-- Image generation counter (null for text-only calls)
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS images_generated integer;

-- Cost breakdown (null until calculated)
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_input   numeric(10,6);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_output  numeric(10,6);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cost_usd_cached  numeric(10,6);

-- Snapshot of the ceiling that was active when this call was made
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS monthly_ceiling_usd numeric(10,2);

-- Error tracking
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS error_code text;

-- Upgrade existing cost_usd column from numeric(10,4) to numeric(10,6)
-- Drop any view that depends on cost_usd first, recreated below.
DROP VIEW IF EXISTS v_brand_monthly_spend;
ALTER TABLE usage_logs
  ALTER COLUMN cost_usd TYPE numeric(10,6)
  USING cost_usd::numeric(10,6);

-- ── 2. Indexes on new columns ─────────────────────────────────────────────────

-- Fast monthly roll-up per brand (the primary CEO cost-check query)
CREATE INDEX IF NOT EXISTS idx_usage_logs_brand_created
  ON usage_logs (brand_id, created_at DESC);

-- Per-agent cost analysis
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_created
  ON usage_logs (agent, created_at DESC)
  WHERE agent IS NOT NULL;

-- Trace a specific n8n run across all its log rows
CREATE INDEX IF NOT EXISTS idx_usage_logs_flow_run_id
  ON usage_logs (flow_run_id)
  WHERE flow_run_id IS NOT NULL;

-- Error investigation
CREATE INDEX IF NOT EXISTS idx_usage_logs_error_code
  ON usage_logs (error_code)
  WHERE error_code IS NOT NULL;

-- ── 3. brand_cost_config table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brand_cost_config (
  brand_id             uuid        NOT NULL PRIMARY KEY
                                   REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  monthly_ceiling_usd  numeric(10,2) NOT NULL DEFAULT 50.00,
  tier                 text        NOT NULL DEFAULT 'standard'
                                   CHECK (tier IN ('starter','standard','professional','enterprise')),
  alert_at_pct         integer     NOT NULL DEFAULT 70
                                   CHECK (alert_at_pct BETWEEN 1 AND 99),
  halt_at_pct          integer     NOT NULL DEFAULT 100
                                   CHECK (halt_at_pct BETWEEN 1 AND 200),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_brand_cost_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_cost_config_updated_at ON brand_cost_config;
CREATE TRIGGER trg_brand_cost_config_updated_at
  BEFORE UPDATE ON brand_cost_config
  FOR EACH ROW EXECUTE FUNCTION set_brand_cost_config_updated_at();

-- ── 4. RLS on brand_cost_config ───────────────────────────────────────────────

ALTER TABLE brand_cost_config ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (n8n, Memory Controller)
-- Authenticated brand owner can read their own config
CREATE POLICY "brand_cost_config_owner_read"
  ON brand_cost_config FOR SELECT
  TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM brand_profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- Only service role (n8n / admin API) can write
CREATE POLICY "brand_cost_config_service_write"
  ON brand_cost_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 5. Seed default cost config for all existing brands ──────────────────────

INSERT INTO brand_cost_config (brand_id)
SELECT brand_id FROM brand_profiles
ON CONFLICT (brand_id) DO NOTHING;

-- ── 6. Helper view: current-month spend per brand ─────────────────────────────
-- Used by CEO pre-call check; n8n calls:
--   SELECT * FROM v_brand_monthly_spend WHERE brand_id = $1
CREATE OR REPLACE VIEW v_brand_monthly_spend AS
SELECT
  bc.brand_id,
  bc.monthly_ceiling_usd,
  bc.alert_at_pct,
  bc.halt_at_pct,
  COALESCE(SUM(ul.cost_usd), 0)::numeric(10,6)            AS current_month_spend_usd,
  ROUND(
    COALESCE(SUM(ul.cost_usd), 0) / NULLIF(bc.monthly_ceiling_usd, 0) * 100,
    1
  )                                                         AS spend_pct,
  CASE
    WHEN COALESCE(SUM(ul.cost_usd), 0) >= bc.monthly_ceiling_usd
      THEN 'breached'
    WHEN COALESCE(SUM(ul.cost_usd), 0) >= bc.monthly_ceiling_usd * bc.halt_at_pct / 100.0
      THEN 'critical'
    WHEN COALESCE(SUM(ul.cost_usd), 0) >= bc.monthly_ceiling_usd * bc.alert_at_pct / 100.0
      THEN 'approaching'
    ELSE 'normal'
  END                                                       AS cost_status
FROM brand_cost_config bc
LEFT JOIN usage_logs ul
  ON ul.brand_id = bc.brand_id
 AND ul.created_at >= date_trunc('month', now())
 AND ul.status = 'success'
GROUP BY bc.brand_id, bc.monthly_ceiling_usd, bc.alert_at_pct, bc.halt_at_pct;

-- Grant read access on the view to authenticated users and service role
GRANT SELECT ON v_brand_monthly_spend TO authenticated, service_role;
