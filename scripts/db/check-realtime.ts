import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

const rt = await c.query(`
  select tablename from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename in ('branddna_event_log','memory_controller_queue')
`)
console.log('Realtime-enabled tables:', rt.rows.map(r => r.tablename))

const ri = await c.query(`
  select relname, relreplident
  from pg_class
  where relname in ('branddna_event_log','memory_controller_queue')
`)
console.log('Replica identity:')
for (const r of ri.rows) {
  const label = r.relreplident === 'f' ? 'FULL' : r.relreplident === 'd' ? 'DEFAULT' : r.relreplident
  console.log(`  ${r.relname}: ${label}`)
}

await c.end()
