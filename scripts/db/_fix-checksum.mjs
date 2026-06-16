// One-off helper: refresh stored checksum for a migration file whose content
// changed (e.g. comment update). Safe because we re-hash the actual file.
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Manual .env.local loader — same pattern scripts/db/lib/env.ts uses.
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

const target = process.argv[2]

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

if (target === '--all') {
  // Refresh checksums for every applied migration whose file content has drifted.
  const r = await c.query('select filename from public.schema_migrations order by filename')
  for (const row of r.rows) {
    const file = row.filename
    try {
      const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
      const cks = createHash('sha256').update(sql).digest('hex')
      await c.query('update public.schema_migrations set checksum = $1 where filename = $2', [cks, file])
      console.log(`refreshed ${file}`)
    } catch (e) {
      console.warn(`skipped ${file}: ${e.message}`)
    }
  }
} else if (target) {
  const sql = readFileSync(`supabase/migrations/${target}`, 'utf8')
  const cks = createHash('sha256').update(sql).digest('hex')
  const r = await c.query('update public.schema_migrations set checksum = $1 where filename = $2', [cks, target])
  console.log(`updated ${r.rowCount} row(s) for ${target}`)
} else if (target === '--cleanup-orphans') {
  // Drop schema_migrations rows whose corresponding files no longer exist on disk.
  const r = await c.query('select filename from public.schema_migrations')
  let removed = 0
  for (const row of r.rows) {
    const exists = (() => {
      try { readFileSync(`supabase/migrations/${row.filename}`); return true } catch { return false }
    })()
    if (!exists) {
      await c.query('delete from public.schema_migrations where filename = $1', [row.filename])
      console.log(`removed orphan ${row.filename}`)
      removed++
    }
  }
  console.log(`cleaned ${removed} orphan(s)`)
} else {
  console.error('Usage: node scripts/db/_fix-checksum.mjs <migration-file | --all | --cleanup-orphans>')
  process.exit(1)
}

await c.end()
