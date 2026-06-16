// One-off: prove the copilot migration landed.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const envPath = path.resolve('.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

console.log('▼ Tables')
const t = await c.query(`
  select table_name
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('copilot_threads','copilot_messages')
   order by table_name
`)
for (const r of t.rows) console.log('  ✓', r.table_name)

console.log('\n▼ Helper function')
const f = await c.query(`
  select routine_name, data_type
    from information_schema.routines
   where routine_schema = 'public'
     and routine_name = 'current_copilot_role'
`)
for (const r of f.rows) console.log('  ✓', r.routine_name, '→', r.data_type)

console.log('\n▼ RLS policies (copilot_*)')
const p = await c.query(`
  select tablename, policyname
    from pg_policies
   where schemaname = 'public'
     and policyname like '%copilot%'
   order by tablename, policyname
`)
for (const r of p.rows) console.log('  ✓', r.tablename.padEnd(28), r.policyname)

console.log('\n▼ RLS enabled on conversation tables')
const r = await c.query(`
  select relname, relrowsecurity
    from pg_class
   where relname in ('copilot_threads','copilot_messages')
`)
for (const row of r.rows) console.log('  ✓', row.relname.padEnd(20), 'rls=', row.relrowsecurity)

console.log('\n▼ Touch trigger')
const tr = await c.query(`
  select trigger_name, event_object_table
    from information_schema.triggers
   where trigger_name = 'trg_copilot_touch_thread'
`)
for (const row of tr.rows) console.log('  ✓', row.trigger_name, '→', row.event_object_table)

console.log('\n▼ Schema-migrations record')
const m = await c.query(`select filename, applied_at from public.schema_migrations where filename = '0018_admin_copilots.sql'`)
for (const row of m.rows) console.log('  ✓', row.filename, '@', row.applied_at)

await c.end()
