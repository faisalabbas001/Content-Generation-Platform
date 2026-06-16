import pg from 'pg'

const connectionString = 'postgres://postgres.redzmrlzhxkkpgcokgvl:ogzstudios%40weiblocks.io@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'
const BRAND_ID = '1e3ee34b-a674-4005-87c6-c352d8337ddf'

const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await c.connect()

const results = {}

// 3. branddna_event_log — cast enum to text for LIKE
try {
  const r = await c.query(`
    SELECT event_id, event_type::text as event_type, event_data, created_at
    FROM public.branddna_event_log
    WHERE brand_id = $1
      AND event_type::text LIKE 'correction_progress_%'
    ORDER BY created_at DESC LIMIT 30
  `, [BRAND_ID])
  results.branddna_event_log = r.rows
} catch (e) {
  results.branddna_event_log = { error: e.message }
}

// 4. memory_controller_queue — column is nominated_at not created_at
try {
  const r = await c.query(`
    SELECT nomination_id, nomination_type, nomination_data, nominated_by, status, rejection_reason, nominated_at, processed_at
    FROM public.memory_controller_queue
    WHERE brand_id = $1
      AND nominated_by = 'CEO'
    ORDER BY nominated_at DESC LIMIT 15
  `, [BRAND_ID])
  results.memory_controller_queue = r.rows
} catch (e) {
  results.memory_controller_queue = { error: e.message }
}

// 5. source_records — column is source_id not record_id, captured_at not created_at
try {
  const r = await c.query(`
    SELECT source_id, source_type, raw_payload, captured_at
    FROM public.source_records
    WHERE brand_id = $1
      AND source_type::text = 'correction'
    ORDER BY captured_at DESC LIMIT 10
  `, [BRAND_ID])
  results.source_records = r.rows
} catch (e) {
  results.source_records = { error: e.message }
}

// 6. evidence_bundles — column is agreement_ratio not agreement_score, field_confidence not confidence_state, last_evaluated not updated_at
try {
  const r = await c.query(`
    SELECT field_name, field_confidence, agreement_ratio, recency_score, conflict_score, last_evaluated
    FROM public.evidence_bundles
    WHERE brand_id = $1
      AND field_name = 'price_position'
  `, [BRAND_ID])
  results.evidence_bundles = r.rows
} catch (e) {
  results.evidence_bundles = { error: e.message }
}

// 7. confidence_classifications — column is mode not confidence_mode, reasons not human_gate_reasons
try {
  const r = await c.query(`
    SELECT classification_id, mode, reasons, created_at
    FROM public.confidence_classifications
    WHERE brand_id = $1
    ORDER BY created_at DESC LIMIT 5
  `, [BRAND_ID])
  results.confidence_classifications = r.rows
} catch (e) {
  results.confidence_classifications = { error: e.message }
}

await c.end()
console.log(JSON.stringify(results, null, 2))
