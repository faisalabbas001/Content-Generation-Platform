import pg from 'pg'

const connectionString = 'postgres://postgres.redzmrlzhxkkpgcokgvl:ogzstudios%40weiblocks.io@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'
const BRAND_ID = '1e3ee34b-a674-4005-87c6-c352d8337ddf'

const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await c.connect()

// Inspect columns of failing tables
const tables = ['branddna_event_log', 'memory_controller_queue', 'source_records', 'evidence_bundles', 'confidence_classifications']
const schema = {}

for (const t of tables) {
  const r = await c.query(`
    SELECT column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [t])
  schema[t] = r.rows
}

// Also check event_type enum values for branddna_event_log
try {
  const r = await c.query(`SELECT DISTINCT event_type FROM public.branddna_event_log WHERE brand_id = $1 LIMIT 20`, [BRAND_ID])
  schema['branddna_event_log_sample_events'] = r.rows
} catch(e) {
  schema['branddna_event_log_sample_events'] = { error: e.message }
}

await c.end()
console.log(JSON.stringify(schema, null, 2))
