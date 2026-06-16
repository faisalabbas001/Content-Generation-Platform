-- ─────────────────────────────────────────────────────────────────────────────
-- 0075_system_config.sql
-- Generic key-value config table for system-wide settings.
-- First use: system cost ceiling.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
  key        text        NOT NULL PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION set_system_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION set_system_config_updated_at();

-- RLS: only service role may write; authenticated users cannot read
-- (this table is admin-only, accessed via service role key from server actions)
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_config_service_only"
  ON system_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed default cost config
INSERT INTO system_config (key, value)
VALUES ('cost', '{"monthly_ceiling_usd": 200, "alert_at_pct": 70, "halt_at_pct": 100}')
ON CONFLICT (key) DO NOTHING;
