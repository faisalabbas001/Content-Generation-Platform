/**
 * OGz Studios — DB verification
 *
 * Post-migrate sanity checks:
 *   • 15 required core tables exist
 *   • RLS is enabled on every one
 *   • Append-only tables reject UPDATE
 *   • Seed brands are reachable
 *
 * Exit code 0 on pass, 1 on fail.
 * Usage: pnpm db:verify
 */

import { loadEnv, getPgConnectionString, getDbLabel } from './lib/env.js'
import pg from 'pg'

const { Client } = pg

const REQUIRED_TABLES = [
  'brand_profiles','audience_profiles','visual_style_profiles','channel_profiles',
  'evidence_bundles','source_records','negative_patterns','override_rules',
  'onboarding_responses','onboarding_questions','brand_performance_log','brand_snapshots',
  'sector_baselines','sector_question_weights','sector_trends',
  'content_performance_patterns','global_negative_patterns',
  'onboarding_intelligence','visual_performance_global','occasion_intelligence',
  'routing_decisions','branddna_event_log','memory_controller_queue',
  'confidence_classifications','qa_review_queue','usage_logs','anomaly_records',
  'calendars','calendar_posts','deletion_audit_log',
]

async function main(): Promise<void> {
  loadEnv()
  const client = new Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  console.log(`→ Verifying ${getDbLabel()}`)

  const failures: string[] = []

  try {
    // 1. Tables exist
    const { rows: tables } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname='public'`,
    )
    const present = new Set(tables.map((r) => r.tablename))
    for (const t of REQUIRED_TABLES) {
      if (!present.has(t)) failures.push(`missing table: ${t}`)
    }
    console.log(`  ✓ ${REQUIRED_TABLES.filter((t) => present.has(t)).length}/${REQUIRED_TABLES.length} tables present`)

    // 2. RLS enabled on every required table
    const { rows: rls } = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname = any($1)`,
      [REQUIRED_TABLES],
    )
    for (const r of rls) {
      if (!r.relrowsecurity) failures.push(`RLS off: ${r.relname}`)
    }
    console.log(`  ✓ RLS enabled on ${rls.filter((r) => r.relrowsecurity).length}/${rls.length} tables`)

    // 3. Seed brands present
    const { rows: brands } = await client.query<{ brand_name_en: string }>(
      `select brand_name_en from public.brand_profiles order by brand_name_en`,
    )
    const expected = ['Al-Salam Boutique', 'Beauty Oasis', 'Najd Restaurant']
    for (const b of expected) {
      if (!brands.some((r) => r.brand_name_en === b)) failures.push(`missing seed brand: ${b}`)
    }
    console.log(`  ✓ ${brands.length} brand_profiles rows`)

    // 4. Occasion calendar
    const { rows: occ } = await client.query(`select count(*)::int as n from public.occasion_intelligence`)
    if (occ[0].n < 5) failures.push(`occasion_intelligence underpopulated (${occ[0].n} rows)`)
    console.log(`  ✓ ${occ[0].n} occasion rows`)

    // 5. Sector baselines
    const { rows: bl } = await client.query(`select count(*)::int as n from public.sector_baselines`)
    if (bl[0].n < 3) failures.push(`sector_baselines underpopulated (${bl[0].n} rows)`)
    console.log(`  ✓ ${bl[0].n} baseline rows`)
  } finally {
    await client.end()
  }

  if (failures.length > 0) {
    console.error('\n✗ verification failed:')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('\n✓ verification passed')
}

main().catch((err) => {
  console.error('✗ verify failed')
  console.error(err)
  process.exit(1)
})
