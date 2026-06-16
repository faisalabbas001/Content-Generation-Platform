import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

const constraints = await c.query(`
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.branddna_event_log'::regclass
`)
console.log('=== Constraints ===')
for (const r of constraints.rows) console.log(r.conname, ':', r.def)

const cols = await c.query(`
  select column_name, data_type, character_maximum_length, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'branddna_event_log'
  order by ordinal_position
`)
console.log('\n=== Columns ===')
for (const r of cols.rows) console.log(r.column_name, r.data_type, r.is_nullable)

// Try a direct insert with correction_progress_ prefix
const testInsert = await c.query(`
  insert into public.branddna_event_log (brand_id, event_type, event_data)
  select brand_id, 'correction_progress_test', '{"stage":"test"}'::jsonb
  from public.brand_profiles
  limit 1
  returning event_id, event_type
`).catch(e => ({ error: e.message }))
console.log('\n=== Test insert result ===', JSON.stringify(testInsert))

// Clean up
if (!('error' in testInsert)) {
  await c.query(`delete from public.branddna_event_log where event_type = 'correction_progress_test'`)
}

await c.end()
