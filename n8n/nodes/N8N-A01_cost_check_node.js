// ─────────────────────────────────────────────────────────────────────────────
// N8N-A01  »  "Check: Cost Ceiling" — Code Node (typeVersion 2)
//
// Place this node IMMEDIATELY AFTER "Supabase: Insert Calendar Lease1" and
// BEFORE "Prepare Brand Data". Wire it so that:
//   - output[0] (true branch)  → Prepare Brand Data  (generation allowed)
//   - output[1] (false branch) → Build S03 alert1     (ceiling breached)
//
// The IF node that follows this Code node should check:
//   $json.cost_allowed === true   →  true branch
//   $json.cost_allowed === false  →  false branch
//
// Usage logs trigger fn_cost_ceiling_enforcer synchronously on INSERT, so by
// the time this node runs, brand_cost_config.cost_blocked already reflects the
// latest total. Reading brand_cost_config is therefore a single-row lookup
// (vs summing usage_logs rows) and adds < 50 ms per brand.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL        = 'https://redzmrlzhxkkpgcokgvl.supabase.co';
const SUPABASE_SERVICE_KEY = $env.SUPABASE_SERVICE_ROLE_KEY;

// brand_id comes from the calendar lease upsert result (or Prepare Batch Config)
const brand_id = $json.brand_id
  ?? $('Prepare Batch Config').first().json.target_brand_id
  ?? null;

if (!brand_id) {
  // No brand context — pass through (should not happen in normal flow)
  return [{ json: { ...$json, cost_allowed: true, cost_status: 'unknown' } }];
}

// ── Read brand_cost_config (single row, maintained by DB trigger) ─────────────
let costRow = null;
try {
  const res = await $helpers.httpRequest({
    method:  'GET',
    url:     `${SUPABASE_URL}/rest/v1/brand_cost_config?brand_id=eq.${brand_id}&select=cost_blocked,current_month_cost_usd,monthly_ceiling_usd,halt_at_pct,alert_at_pct`,
    headers: {
      apikey:        SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    json: true,
  });
  costRow = Array.isArray(res) ? res[0] : null;
} catch (e) {
  console.error('[cost-check] brand_cost_config fetch failed:', e.message);
  // Non-fatal: allow generation to proceed so a single DB hiccup doesn't
  // block the entire batch. N8N-S02 will catch ceiling breaches on its own.
  return [{ json: { ...$json, cost_allowed: true, cost_status: 'fetch_error' } }];
}

if (!costRow) {
  // No config row yet (race condition on brand creation) — allow and seed.
  return [{ json: { ...$json, cost_allowed: true, cost_status: 'no_config' } }];
}

const spend_pct = costRow.monthly_ceiling_usd > 0
  ? Math.round((costRow.current_month_cost_usd / costRow.monthly_ceiling_usd) * 100)
  : 0;

// cost_blocked is set TRUE by fn_cost_ceiling_enforcer when halt_at_pct crossed.
const cost_allowed  = !costRow.cost_blocked;
const cost_status   = costRow.cost_blocked
  ? 'breached'
  : spend_pct >= costRow.alert_at_pct
    ? 'approaching'
    : 'normal';

const result = {
  ...$json,
  cost_allowed,
  cost_status,
  current_month_spend_usd: costRow.current_month_cost_usd,
  monthly_ceiling_usd:     costRow.monthly_ceiling_usd,
  spend_pct,
  // Pass cost context forward so CEO classify / COO can use it
  cost_context: {
    current_month_spend_usd: costRow.current_month_cost_usd,
    monthly_ceiling_usd:     costRow.monthly_ceiling_usd,
    spend_pct,
    cost_status,
  },
};

// Log the check to usage_logs (lightweight, no cost_usd so trigger is no-op)
try {
  await $helpers.httpRequest({
    method:  'POST',
    url:     `${SUPABASE_URL}/rest/v1/usage_logs`,
    headers: {
      apikey:        SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify({
      brand_id,
      flow_id:      'N8N-A01',
      node_name:    'Check: Cost Ceiling',
      agent:        'Spine',
      status:       cost_allowed ? 'success' : 'blocked',
      payload:      { cost_status, spend_pct, current_month_spend_usd: costRow.current_month_cost_usd },
      cost_usd:     0,  // no generation cost — trigger fn is a no-op for cost_usd=0
    }),
  });
} catch (_) { /* non-fatal logging */ }

return [{ json: result }];
