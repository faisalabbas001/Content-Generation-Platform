import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

const r = await c.query(`
  insert into public.branddna_event_log (brand_id, event_type, event_data)
  select brand_id, 'correction_progress_ceo_classifying', '{"stage":"ceo_classifying"}'::jsonb
  from public.brand_profiles limit 1
  returning event_id, event_type
`).catch(e => e)

if (r instanceof Error) {
  console.log('FAIL:', r.message)
} else {
  console.log('OK — inserted:', JSON.stringify(r.rows[0]))
  await c.query(`delete from public.branddna_event_log where event_id = '${r.rows[0].event_id}'`)
  console.log('Cleaned up.')
}

await c.end()
