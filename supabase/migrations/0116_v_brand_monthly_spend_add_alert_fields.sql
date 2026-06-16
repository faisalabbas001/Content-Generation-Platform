-- 0116: Refresh v_brand_monthly_spend to expose last_alert_sent_at and last_alert_type.
-- S02's Classify node reads these for alert deduplication (migration 0115 added the columns).

CREATE OR REPLACE VIEW v_brand_monthly_spend AS
SELECT
  bcc.brand_id,
  bcc.monthly_ceiling_usd,
  bcc.alert_at_pct,
  bcc.halt_at_pct,
  bcc.cost_blocked,
  bcc.current_month_cost_usd                                          AS current_month_spend_usd,
  bcc.last_alert_sent_at,
  bcc.last_alert_type,
  CASE
    WHEN bcc.monthly_ceiling_usd > 0
    THEN ROUND((bcc.current_month_cost_usd / bcc.monthly_ceiling_usd) * 100, 2)
    ELSE 0
  END                                                                  AS spend_pct,
  CASE
    WHEN bcc.cost_blocked
      OR bcc.current_month_cost_usd >= bcc.monthly_ceiling_usd       THEN 'breached'
    WHEN bcc.monthly_ceiling_usd > 0
      AND (bcc.current_month_cost_usd / bcc.monthly_ceiling_usd) * 100
          >= bcc.halt_at_pct                                          THEN 'critical'
    WHEN bcc.monthly_ceiling_usd > 0
      AND (bcc.current_month_cost_usd / bcc.monthly_ceiling_usd) * 100
          >= bcc.alert_at_pct                                         THEN 'approaching'
    ELSE 'normal'
  END                                                                  AS cost_status
FROM brand_cost_config bcc;

-- Grant read access to service role (already granted on underlying table)
GRANT SELECT ON v_brand_monthly_spend TO service_role;
