#!/usr/bin/env node
/**
 * Inspect supabase_realtime publication. Lists every table currently
 * enabled for realtime broadcasting.
 */
import pg from 'pg'
import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 0) continue
  const k = t.slice(0, eq).trim()
  let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

const r = await c.query(`
  select schemaname, tablename
  from pg_publication_tables
  where pubname = 'supabase_realtime'
  order by schemaname, tablename
`)

console.log(`supabase_realtime publication has ${r.rowCount} table(s):`)
for (const row of r.rows) console.log(`  · ${row.schemaname}.${row.tablename}`)

const r2 = await c.query(`
  select relname, relreplident from pg_class
  where relname in ('brand_snapshots','brand_profiles')
  and relnamespace = 'public'::regnamespace
`)
console.log('\nReplica identity (needs FULL or DEFAULT for realtime payloads):')
for (const row of r2.rows) console.log(`  · ${row.relname}  → ${row.relreplident}`)

await c.end()
