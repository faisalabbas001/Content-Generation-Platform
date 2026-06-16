import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

async function main() {
  loadEnv()
  const c = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    const { rows } = await c.query<{
      tablename: string
      policyname: string
      cmd: string
      qual: string | null
      with_check: string | null
    }>(
      `select tablename, policyname, cmd, qual, with_check
         from pg_policies
        where schemaname='public'
          and tablename in ('brand_profiles','source_records','override_rules','deletion_audit_log','audience_profiles','evidence_bundles')
        order by tablename, cmd, policyname`,
    )
    for (const r of rows) {
      const guard = (r.with_check ?? r.qual ?? '').replace(/\s+/g, ' ')
      console.log(`  ${r.tablename.padEnd(22)} ${r.cmd.padEnd(7)} ${r.policyname.padEnd(36)} ${guard.slice(0, 90)}`)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
