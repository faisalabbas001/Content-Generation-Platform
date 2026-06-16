# Chain Selection & Cost Monitoring — Implementation Guide

**Branch:** `moazzam-dev5`  
**Migration:** `0099_chain_scoring_and_cost_ceiling.sql`  
**Date:** 2026-06-04

---

## 1. What Was Changed

### 1.1 Database (`supabase/migrations/0099_chain_scoring_and_cost_ceiling.sql`)

| Change | Purpose |
|--------|---------|
| `chains.style_affinity` (TEXT, nullable) | Maps to `style_register_type` enum: `traditional\|modern\|youth\|mixed`. `NULL` = chain matches any style register. |
| `chains.platform_tags` (TEXT[], nullable) | Lowercase platform tokens (`instagram`, `snapchat`, `tiktok`, `twitter`). `NULL` = all platforms. |
| View `brand_chain_approval_rate` | Per-brand per-chain approval rate computed from `usage_logs`. Drives §9.5 brand approval score (0–40 pts). |
| View `chain_platform_approval_rate` | Platform-wide per-chain approval rate. Drives §9.5 platform score (0–30 pts). |
| View `v_chain_health` | Shows each chain's health: `healthy` / `review` / `suspend` / `insufficient_data`. |
| `brand_cost_config.current_month_cost_usd` | Running monthly total maintained by DB trigger (no more SUM on every CEO call). |
| `brand_cost_config.cost_blocked` | Boolean. Set TRUE by trigger when `halt_at_pct` crossed. n8n reads this instead of summing rows. |
| `brand_cost_config.last_reset_month` | Tracks month rollover (e.g. `'2026-06'`). Trigger resets total automatically. |
| Trigger `fn_cost_ceiling_enforcer` on `usage_logs` | Fires AFTER INSERT. Increments running total, sets `cost_blocked`, inserts into `anomaly_records`. |
| Unique constraint `anomaly_records_brand_anomaly_uniq(brand_id, anomaly_type)` | Prevents duplicate anomaly rows during a generation batch. |

### 1.2 Backend TypeScript (`packages/db/src/queries/chains.ts`)

- **`ChainRow` interface** — added `style_affinity` and `platform_tags` fields (migration 0099 columns).
- **`selectChainsForSlot()`** — new primary function. Returns `ScoredChain[]` (top N, default 3). Implements full §9.5 scoring:
  - Filter: sector + platform + output_type + quality_tier + maturity + occasion exclusion + cultural safety gate
  - Boost: `+20` for chains explicitly tagged for the active occasion
  - Score: style match (0–30) + brand approval (0–40) + platform approval (0–30)
  - Sort: highest score → lower cost → chain_id lexicographic
- **`selectChainForSlot()`** — backward-compatible wrapper. Now calls `selectChainsForSlot({ topN: 1 })`. Existing callers unchanged.
- **`ScoredChain` interface** — exported for plan-slots and Prompt Composer.

### 1.3 plan-slots Route (`apps/web/src/app/api/agents/calendar/plan-slots/route.ts`)

- Loads `visual_style_profiles.style_register` and `brand_profiles.primary_channel` alongside existing brand data.
- Passes `style_register`, `primary_channel`, and `brand_id` into chain selection.
- Returns both the standard `CalendarPlan` (backward-compatible) **and** `slots_with_top_chains` — an array containing the top-3 scored chains per slot with score breakdowns.

### 1.4 n8n Cost-Check Node (`n8n/nodes/N8N-A01_cost_check_node.js`)

Reads `brand_cost_config.cost_blocked` (single row, O(1)) instead of summing `usage_logs`. Outputs:
- `cost_allowed: true/false`
- `cost_status: 'normal' | 'approaching' | 'breached'`
- `spend_pct: number`

---

## 2. n8n Workflow Changes Required

### 2.1 N8N-A01: Add Cost-Check Node

Insert a **Code Node** immediately after `Supabase: Insert Calendar Lease1` and before `Prepare Brand Data`:

```
[Supabase: Insert Calendar Lease1]
         ↓
[Code: Check Cost Ceiling]   ←— paste n8n/nodes/N8N-A01_cost_check_node.js
         ↓
[IF: cost_allowed == true?]
   true  → [Prepare Brand Data]
   false → [Build S03 alert1]
```

**IF node condition:**
```
Left value:  ={{ $json.cost_allowed }}
Operator:    equals
Right value: true (boolean)
```

The false branch feeds into the existing `Build S03 alert1` node (already wired for error reporting).

### 2.2 N8N-A01: plan-slots Already Correct — No Chain Changes Needed

The `Sign: Plan Slots` → `HTTP: Plan Slots` calls are already in place. After migration 0099:
- The endpoint automatically uses real approval rates instead of stubs.
- The response now includes `slots_with_top_chains` with top-3 chains per slot.
- The `Merge Posts Data1` node already reads `slot.chain_id` from the plan-slots result — no change needed there.

### 2.3 CEO classify: Remove Chain Selection Responsibility

The `ceo/classify` route currently passes `availableChains` to the CEO LLM **only for `calendar_ondemand` requests**. The CEO prompt uses this to optionally return a `selected_chain`. This is fine to keep as a fallback, but the primary selection is now deterministic via `plan-slots`. No code change is required — the deterministic result from `plan-slots` always takes precedence in `Merge Posts Data1` because plan-slots runs after CEO classify.

### 2.4 Pass cost_context into CEO classify payload

In the `Sign: CEO Route & Classify` n8n Code Node, add `cost_context` from the cost check to the payload so the CEO receives current spend state (it already receives `current_month_spend_usd` and `monthly_ceiling_usd` from the batch config; this makes it more precise):

```javascript
// In Sign: CEO Route & Classify body construction, add:
const costCtx = $('Check: Cost Ceiling')?.first()?.json?.cost_context || {};

const bodyObj = {
  flow_id: 'N8N-A01',
  brand_id: brandData.brand_id,
  payload: {
    // ... existing fields ...
    current_month_spend_usd: costCtx.current_month_spend_usd ?? brandData.current_month_spend_usd,
    monthly_ceiling_usd:     costCtx.monthly_ceiling_usd ?? brandData.monthly_ceiling_usd,
  }
};
```

---

## 3. How §9.5 Scoring Works (Concrete Example)

**Brand:** F&B, Riyadh, Najdi, `style_register = 'traditional'`, `primary_channel = 'Instagram'`, 45 days old, `quality_tier = 'growth'`  
**Occasion:** `ramadan`

**After FILTER** (hypothetical 10 eligible chains):

| chain_id | style_affinity | occasion_tagged | brand_rate_pct | platform_rate_pct |
|----------|---------------|-----------------|----------------|-------------------|
| tf07_01  | traditional   | ramadan ✓       | 85%            | 78%               |
| tf01_03  | null          | —               | 72%            | 65%               |
| tf04_02  | modern        | —               | 90%            | 82%               |

**Scoring:**

| chain_id | occasion (+20) | style (0-30) | brand (0-40) | platform (0-30) | **total** |
|----------|---------------|--------------|--------------|-----------------|-----------|
| tf07_01  | +20           | +30          | +34          | +23             | **107**   |
| tf01_03  | 0             | +15          | +29          | +20             | **64**    |
| tf04_02  | 0             | 0            | +36          | +25             | **61**    |

**Top-3 selected:** `[tf07_01, tf01_03, tf04_02]`  
**Primary (top-1) assigned to slot:** `tf07_01`

---

## 4. Cost Monitoring Flow

```
N8N generates post
    ↓
/api/image/generate writes to usage_logs (cost_usd = chain.cost_estimate_usd)
    ↓
fn_cost_ceiling_enforcer fires (AFTER INSERT, synchronous)
    ↓
    ├─ Checks last_reset_month → resets if month changed
    ├─ Increments brand_cost_config.current_month_cost_usd
    ├─ If spend_pct >= halt_at_pct → sets cost_blocked = TRUE
    └─ If threshold crossed → upserts anomaly_records row
    ↓
N8N-S02 (every 6h) reads v_brand_monthly_spend → alerts N8N-S03
N8N-A01 (per brand) reads brand_cost_config.cost_blocked → skips if TRUE
```

---

## 5. Testing Checklist

### 5.1 Chain Scoring — Unit Verification

Run this SQL after applying migration 0099:

```sql
-- 1. Verify style_affinity column exists with correct defaults
SELECT chain_id, family, style_affinity, platform_tags
FROM chains
WHERE family IN ('TF07','TF08','TF01','TF10')
ORDER BY family, chain_id
LIMIT 20;
-- Expected: TF07/08 rows have style_affinity = 'traditional'; TF10 = 'modern'; TF01 = NULL

-- 2. Confirm views exist and return data (will be empty until usage_logs has rows)
SELECT COUNT(*) FROM brand_chain_approval_rate;
SELECT COUNT(*) FROM chain_platform_approval_rate;
SELECT COUNT(*) FROM v_chain_health;

-- 3. Verify health status logic
SELECT chain_id, health_status, platform_approval_rate_pct
FROM v_chain_health
ORDER BY health_status, chain_id
LIMIT 30;
-- All should be 'insufficient_data' before any generations run
```

### 5.2 Chain Scoring — API Integration Test

Call `POST /api/agents/calendar/plan-slots` with a test brand that has a `religious_sensitivity = 'High'` value (conservative gate), a `ramadan` occasion flag, and `primary_channel = 'Instagram'`:

```json
{
  "flow_id": "N8N-A01",
  "brand_id": "<test_brand_uuid>",
  "payload": {
    "post_count": 5,
    "occasion_flags": ["ramadan_2026"],
    "schedule_dates": []
  }
}
```

**Verify in response:**
- [ ] `slots_with_top_chains` array is present
- [ ] Each slot has `top_chains` with 1–3 entries
- [ ] `score_breakdown` shows `occasion_boost: 20` for slots where `format = 'video'` or chain is ramadan-tagged
- [ ] No chain with `cultural_constraints.high_religious_sensitivity = true` appears in any slot's `top_chains`
- [ ] `chain_id` in each slot matches `top_chains[0].chain_id`

### 5.3 Occasion Boost — Verify +20 Applied

```sql
-- After a test run with occasion_flags=['ramadan'], query usage_logs for the
-- chain_ids used and cross-reference with chains.eligible_occasions
SELECT ul.payload->>'chain_id' as chain_id, c.eligible_occasions
FROM usage_logs ul
JOIN chains c ON c.chain_id = ul.payload->>'chain_id'
WHERE ul.created_at > now() - interval '1 hour'
  AND ul.brand_id = '<test_brand_uuid>';
-- Expected: all chain_ids should have eligible_occasions containing 'ramadan'
-- (or be occasion-agnostic with NULL eligible_occasions)
```

### 5.4 Top-3 Ordering — Verify Sort Correctness

In the `slots_with_top_chains` response, for any slot:
```
assert top_chains[0].score >= top_chains[1].score >= top_chains[2].score
assert top_chains[0].chain_id != top_chains[1].chain_id  (no duplicates)
```

### 5.5 Platform Filter — Verify Channel Token Matching

1. Set `brand_profiles.primary_channel = 'Snapchat'` for a test brand.
2. Seed `chains.platform_tags = ARRAY['instagram']` for a chain that would otherwise be eligible.
3. Call `plan-slots` → verify that chain does NOT appear in any slot's `top_chains`.
4. Set `platform_tags = NULL` for the same chain → verify it now appears.

### 5.6 Cost Ceiling — Trigger Test

```sql
-- 1. Set a low ceiling for a test brand
UPDATE brand_cost_config
SET monthly_ceiling_usd = 0.10, halt_at_pct = 100
WHERE brand_id = '<test_brand_uuid>';

-- 2. Insert a row that exceeds the ceiling
INSERT INTO usage_logs (brand_id, flow_id, node_name, status, cost_usd, agent)
VALUES ('<test_brand_uuid>', 'N8N-A01', 'test', 'success', 0.15, 'image');

-- 3. Verify trigger fired correctly
SELECT cost_blocked, current_month_cost_usd, last_reset_month
FROM brand_cost_config
WHERE brand_id = '<test_brand_uuid>';
-- Expected: cost_blocked = TRUE, current_month_cost_usd = 0.15

-- 4. Verify anomaly was created
SELECT anomaly_type, severity, details
FROM anomaly_records
WHERE brand_id = '<test_brand_uuid>'
ORDER BY created_at DESC LIMIT 1;
-- Expected: anomaly_type = 'cost_ceiling_breached', severity = 'critical'
```

### 5.7 Cost Ceiling — Month Rollover Test

```sql
-- Force last_reset_month to a past month
UPDATE brand_cost_config
SET last_reset_month = '2026-05', current_month_cost_usd = 99.99, cost_blocked = TRUE
WHERE brand_id = '<test_brand_uuid>';

-- Insert a new row (trigger should detect month change and reset)
INSERT INTO usage_logs (brand_id, flow_id, node_name, status, cost_usd, agent)
VALUES ('<test_brand_uuid>', 'N8N-A01', 'test', 'success', 0.01, 'image');

SELECT cost_blocked, current_month_cost_usd, last_reset_month
FROM brand_cost_config WHERE brand_id = '<test_brand_uuid>';
-- Expected: cost_blocked = FALSE (reset), current_month_cost_usd = 0.01, last_reset_month = '2026-06'
```

### 5.8 n8n Cost-Check Node — End-to-End

1. Set `cost_blocked = TRUE` for a test brand via SQL.
2. Trigger N8N-A01 via webhook with `{ brand_id: "<test_brand_uuid>" }`.
3. Verify the flow **does not call** `Prepare Brand Data` for that brand.
4. Verify an anomaly row appears in `anomaly_records` with `source_flow = 'N8N-A01'`.
5. Set `cost_blocked = FALSE` and re-trigger → verify generation proceeds normally.

### 5.9 v_chain_health — Suspension Threshold

```sql
-- Manually set a low usage_logs scenario for a specific chain
-- (or wait for real data), then verify health view logic:
SELECT chain_id, health_status, platform_approval_rate_pct
FROM v_chain_health
WHERE platform_approval_rate_pct < 60
ORDER BY platform_approval_rate_pct;
-- Chains < 40% → 'suspend'; chains 40-59% → 'review'; >= 60% → 'healthy'
```

---

## 6. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/0099_chain_scoring_and_cost_ceiling.sql` | **New** — all DB schema changes |
| `packages/db/src/queries/chains.ts` | Modified — full §9.5 scoring, `selectChainsForSlot()`, `ScoredChain` type |
| `apps/web/src/app/api/agents/calendar/plan-slots/route.ts` | Modified — loads `style_register` + `primary_channel`, returns `slots_with_top_chains` |
| `n8n/nodes/N8N-A01_cost_check_node.js` | **New** — n8n Code Node for cost ceiling pre-check |

---

## 7. What Is NOT Changed (and Why)

| Item | Reason |
|------|--------|
| `ceo/classify` route chain pre-filter | Still runs for `calendar_ondemand`. CEO's optional `selected_chain` remains as a valid override. Plan-slots deterministic result takes precedence in `Merge Posts Data1`. |
| `plan-slots` is still called from n8n as-is | No n8n node config change needed — same URL, same HMAC signing. Response now includes `slots_with_top_chains` as an additive field. |
| `N8N-S02` (Cost Ceiling Monitor) | Still runs every 6h via its own schedule. The DB trigger is a real-time complement, not a replacement — S02 is the out-of-band alert path when n8n itself is the spender. |
| CEO LLM for chain selection | CEO may still optionally suggest a chain for `calendar_ondemand`. The scoring algorithm never uses LLM reasoning for the primary deterministic path. |
