-- 0115: Add last_alert_sent_at to brand_cost_config for alert deduplication.
-- S02 reads this before sending to S03 — skips re-alerting if last alert
-- was sent within the cooldown window (24h approaching, 1h breached).
-- Also add last_alert_type so we know what severity was last sent.

ALTER TABLE brand_cost_config
  ADD COLUMN IF NOT EXISTS last_alert_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_alert_type     TEXT;

COMMENT ON COLUMN brand_cost_config.last_alert_sent_at IS
  'When the last cost ceiling alert email was sent for this brand. Used by S02 to skip re-alerting within the cooldown window.';
COMMENT ON COLUMN brand_cost_config.last_alert_type IS
  'The anomaly_type of the last sent alert: cost_ceiling_approaching | cost_ceiling_breached.';
