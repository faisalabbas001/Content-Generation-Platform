import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()

const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

const q1 = await c.query(`
  SELECT relname, relreplident
  FROM pg_class
  WHERE relname = 'branddna_event_log'
`)
console.log('=== Query 1: REPLICA IDENTITY on branddna_event_log ===')
console.log(JSON.stringify(q1.rows, null, 2))

const q2 = await c.query(`
  SELECT relname, relreplident
  FROM pg_class
  WHERE relname IN ('branddna_event_log', 'brand_profiles', 'memory_controller_queue')
`)
console.log('=== Query 2: Replica identity for all three tables ===')
console.log(JSON.stringify(q2.rows, null, 2))

const q3 = await c.query(`
  SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
`)
console.log('=== Query 3: supabase_realtime publication tables ===')
console.log(JSON.stringify(q3.rows, null, 2))

await c.end()
