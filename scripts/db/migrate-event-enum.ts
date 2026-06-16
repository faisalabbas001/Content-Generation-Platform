import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

const newValues = [
  'correction_progress_correction_received',
  'correction_progress_ceo_classifying',
  'correction_progress_ceo_approved',
  'correction_progress_memory_writing',
  'correction_progress_correction_applied',
  'correction_progress_correction_rejected',
]

for (const v of newValues) {
  const r = await c.query(`alter type public.event_type_enum add value if not exists '${v}'`).catch(e => e)
  console.log(v, ':', r instanceof Error ? r.message : 'OK')
}

const vals = await c.query(`select enumlabel from pg_enum where enumtypid = 'public.event_type_enum'::regtype order by enumsortorder`)
console.log('\nAll enum values:\n', vals.rows.map(x => x.enumlabel).join('\n '))
await c.end()
