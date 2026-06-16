-- 0117: RPC function for system-wide monthly cost summary.
-- Replaces 5 separate PostgREST aggregate queries (which fail with PGRST123)
-- with a single server-side function. Called by getSystemMonthlySummary().

CREATE OR REPLACE FUNCTION get_system_monthly_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_month_start TIMESTAMPTZ;
  v_total_spend NUMERIC;
  v_total_calls BIGINT;
  v_by_agent    JSONB;
  v_by_flow     JSONB;
  v_by_rt       JSONB;
  v_brands_active     INT;
  v_brands_approaching INT;
  v_brands_critical   INT;
  v_brands_breached   INT;
BEGIN
  -- Always use UTC month boundary to avoid local-timezone drift
  v_month_start := date_trunc('month', NOW() AT TIME ZONE 'UTC');

  -- 1. Total spend + calls
  SELECT COALESCE(SUM(cost_usd), 0), COUNT(*)
  INTO v_total_spend, v_total_calls
  FROM usage_logs
  WHERE created_at >= v_month_start;

  -- 2. Per-agent spend
  SELECT COALESCE(jsonb_object_agg(agent, spend), '{}')
  INTO v_by_agent
  FROM (
    SELECT COALESCE(agent, 'unknown') AS agent, SUM(cost_usd) AS spend
    FROM usage_logs
    WHERE created_at >= v_month_start AND agent IS NOT NULL
    GROUP BY agent
  ) a;

  -- 3. Per-flow spend
  SELECT COALESCE(jsonb_object_agg(flow_id, spend), '{}')
  INTO v_by_flow
  FROM (
    SELECT COALESCE(flow_id, 'unknown') AS flow_id, SUM(cost_usd) AS spend
    FROM usage_logs
    WHERE created_at >= v_month_start AND flow_id IS NOT NULL
    GROUP BY flow_id
  ) f;

  -- 4. Per-request_type spend
  SELECT COALESCE(jsonb_object_agg(request_type, spend), '{}')
  INTO v_by_rt
  FROM (
    SELECT request_type, SUM(cost_usd) AS spend
    FROM usage_logs
    WHERE created_at >= v_month_start AND request_type IS NOT NULL
    GROUP BY request_type
  ) r;

  -- 5. Brand-level risk counts from the view
  SELECT
    COUNT(*) FILTER (WHERE current_month_spend_usd > 0),
    COUNT(*) FILTER (WHERE cost_status = 'approaching'),
    COUNT(*) FILTER (WHERE cost_status = 'critical'),
    COUNT(*) FILTER (WHERE cost_status = 'breached')
  INTO v_brands_active, v_brands_approaching, v_brands_critical, v_brands_breached
  FROM v_brand_monthly_spend;

  RETURN jsonb_build_object(
    'total_spend_usd',    v_total_spend,
    'total_calls',        v_total_calls,
    'brands_active',      v_brands_active,
    'brands_approaching', v_brands_approaching,
    'brands_critical',    v_brands_critical,
    'brands_breached',    v_brands_breached,
    'by_agent',           v_by_agent,
    'by_flow',            v_by_flow,
    'by_request_type',    v_by_rt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_system_monthly_summary() TO service_role;
