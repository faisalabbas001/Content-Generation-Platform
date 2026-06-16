import pg from 'pg'

const connectionString = 'postgres://postgres.redzmrlzhxkkpgcokgvl:ogzstudios%40weiblocks.io@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'
const BRAND_ID = '1e3ee34b-a674-4005-87c6-c352d8337ddf'

const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await c.connect()

const results = {}

// 1. brand_profiles
try {
  const r = await c.query(`
    SELECT brand_id, brand_name_ar, brand_name_en, client_slug, price_position, arabic_dialect, formality_level, humor_tolerance, religious_sensitivity, bilingual_ratio, brand_differentiator, primary_kpi_type, primary_channel, ramadan_relevance, tone_anti_attribute_ids, archetype_primary, archetype_secondary, lifecycle_stage, intent_state, onboarding_status, completeness_score, updated_at
    FROM public.brand_profiles WHERE brand_id = $1
  `, [BRAND_ID])
  results.brand_profiles = r.rows
} catch (e) {
  results.brand_profiles = { error: e.message }
}

// 2. routing_decisions
try {
  const r = await c.query(`
    SELECT decision_id, flow_id, request_type, pipeline_assigned, agents_dispatched, constraints_applied, confidence_mode, outcome, timestamp
    FROM public.routing_decisions
    WHERE brand_id = $1 AND flow_id = 'N8N-A04'
    ORDER BY timestamp DESC LIMIT 8
  `, [BRAND_ID])
  results.routing_decisions = r.rows
} catch (e) {
  results.routing_decisions = { error: e.message }
}

// 3. branddna_event_log
try {
  const r = await c.query(`
    SELECT event_id, event_type, event_data, created_at
    FROM public.branddna_event_log
    WHERE brand_id = $1
      AND event_type LIKE 'correction_progress_%'
    ORDER BY created_at DESC LIMIT 30
  `, [BRAND_ID])
  results.branddna_event_log = r.rows
} catch (e) {
  results.branddna_event_log = { error: e.message }
}

// 4. memory_controller_queue
try {
  const r = await c.query(`
    SELECT nomination_id, nomination_type, nomination_data, nominated_by, status, rejection_reason, created_at, processed_at
    FROM public.memory_controller_queue
    WHERE brand_id = $1
      AND nominated_by = 'CEO'
    ORDER BY created_at DESC LIMIT 15
  `, [BRAND_ID])
  results.memory_controller_queue = r.rows
} catch (e) {
  results.memory_controller_queue = { error: e.message }
}

// 5. source_records
try {
  const r = await c.query(`
    SELECT record_id, source_type, raw_payload, created_at
    FROM public.source_records
    WHERE brand_id = $1
      AND source_type = 'correction'
    ORDER BY created_at DESC LIMIT 10
  `, [BRAND_ID])
  results.source_records = r.rows
} catch (e) {
  results.source_records = { error: e.message }
}

// 6. evidence_bundles
try {
  const r = await c.query(`
    SELECT field_name, confidence_state, agreement_score, recency_score, conflict_score, updated_at
    FROM public.evidence_bundles
    WHERE brand_id = $1
      AND field_name = 'price_position'
  `, [BRAND_ID])
  results.evidence_bundles = r.rows
} catch (e) {
  results.evidence_bundles = { error: e.message }
}

// 7. confidence_classifications
try {
  const r = await c.query(`
    SELECT classification_id, confidence_mode, human_gate_reasons, created_at
    FROM public.confidence_classifications
    WHERE brand_id = $1
    ORDER BY created_at DESC LIMIT 5
  `, [BRAND_ID])
  results.confidence_classifications = r.rows
} catch (e) {
  results.confidence_classifications = { error: e.message }
}

// 8. anomaly_records
try {
  const r = await c.query(`
    SELECT anomaly_id, anomaly_type, severity, details, resolved, created_at
    FROM public.anomaly_records
    WHERE brand_id = $1 AND resolved = false
  `, [BRAND_ID])
  results.anomaly_records = r.rows
} catch (e) {
  results.anomaly_records = { error: e.message }
}

await c.end()
console.log(JSON.stringify(results, null, 2))
