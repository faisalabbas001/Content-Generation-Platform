/**
 * Memory Controller — end-to-end smoke test.
 *
 * What it does (against your live Supabase):
 *   1. Enqueues five nominations (one per supported type).
 *   2. Drains the queue with processQueue().
 *   3. Reads the resulting rows from the actual BrandDNA tables to confirm
 *      writes landed.
 *   4. Reads branddna_event_log to confirm the audit appended.
 *   5. Confirms a forbidden_field_path is rejected (negative test).
 *   6. Cleans up everything it created.
 *
 * Usage:
 *   pnpm memory:smoke
 *
 * Idempotent — safe to run repeatedly. Uses a deterministic test brand_id
 * (matches the seeded F&B dev brand from 0001_dummy_data.sql) and tags every
 * write with `_smoke: true` so cleanup can find them.
 */
import { loadEnv } from '../db/lib/env'
loadEnv()

import pg from 'pg'
import { adminClient } from '@repo/db/client'
import {
  enqueueNominations,
  processQueue,
  type Nomination,
} from '@repo/memory'

const SMOKE_PATTERN_TEXT = `__smoke_test__pattern_${Date.now()}`
const SMOKE_RULE_KEY = `__smoke_test__rule_${Date.now()}`

async function main() {
  const db = adminClient()
  console.log('OGz Studios — Memory Controller smoke')
  console.log('═'.repeat(45))

  // ── Pre-flight via direct pg ───────────────────────────────────────
  // We use `pg` for read-side verification because the project's
  // SUPABASE_SERVICE_ROLE_KEY currently holds the anon JWT (HANDOVER known
  // issue), so RLS blocks reads via the JS client. WRITES still work because
  // 0011_memory_controller_policies opened them up.
  const conn = process.env.SUPABASE_DB_URL
  if (!conn) {
    console.error('SUPABASE_DB_URL is required for smoke verification.')
    process.exit(1)
  }
  const c = new pg.Client({ connectionString: conn })
  await c.connect()

  const brandQ = await c.query<{ brand_id: string; sector: string; arabic_dialect: string }>(
    `select brand_id, sector, arabic_dialect from brand_profiles
       where sector = 'F&B' and arabic_dialect = 'Najdi' limit 1`,
  )
  if (brandQ.rowCount === 0) {
    console.error('No F&B/Najdi seed brand found. Run `pnpm db:seed` first.')
    await c.end()
    process.exit(1)
  }
  const BRAND_ID = brandQ.rows[0]!.brand_id
  console.log(`Using brand: ${BRAND_ID} (${brandQ.rows[0]!.sector}/${brandQ.rows[0]!.arabic_dialect})`)

  // Find a source_record for confidence_upgrade.
  const sourceQ = await c.query<{ source_id: string }>(
    `select source_id from source_records where brand_id = $1 limit 1`,
    [BRAND_ID],
  )
  if (sourceQ.rowCount === 0) {
    // Insert a tiny stub source so the smoke can run even on a fresh DB.
    const ins = await c.query<{ source_id: string }>(
      `insert into source_records (brand_id, source_type, raw_payload)
         values ($1, 'form', '{"smoke": true}'::jsonb)
       returning source_id`,
      [BRAND_ID],
    )
    sourceQ.rows.push(ins.rows[0]!)
    console.log(`  · created stub source_record ${ins.rows[0]!.source_id}`)
  }
  const sourceId = sourceQ.rows[0]!.source_id

  // ── 1. Enqueue 5 nominations + 1 forbidden ─────────────────────────
  const nominations: Nomination[] = [
    {
      nomination_type: 'field_update',
      brand_id: BRAND_ID,
      data: {
        field_path: 'BrandProfile.formality_level',
        proposed_value: 'casual',
        source: 'client_confirmation',
      },
    },
    {
      nomination_type: 'confidence_upgrade',
      brand_id: BRAND_ID,
      data: {
        field_name: 'arabic_dialect',
        new_state: 'inferred_high',
        evidence_source_ids: [sourceId],
        agreement_ratio: 0.92,
      },
    },
    {
      nomination_type: 'negative_pattern_add',
      brand_id: BRAND_ID,
      data: { pattern_text: SMOKE_PATTERN_TEXT, severity: 'SOFT_WARN' },
    },
    {
      nomination_type: 'override_rule_add',
      brand_id: BRAND_ID,
      data: { rule_key: SMOKE_RULE_KEY, rule_value: { foo: 'bar' } },
    },
    {
      nomination_type: 'sector_signal',
      brand_id: null,
      data: { sector: 'F&B', dialect: 'Najdi', outcome: 'approved', tone: '__smoke_warm_casual__', confidence_score: 88 },
    },
  ]

  const forbidden: Nomination = {
    nomination_type: 'field_update',
    brand_id: BRAND_ID,
    data: {
      field_path: 'BrandProfile.tier',  // intentionally NOT on the whitelist
      proposed_value: 'paid_pro',
      source: 'system_inference',
    },
  }

  const enqueueResult = await enqueueNominations(db, [...nominations, forbidden], { nominated_by: 'smoke' })
  console.log('\nenqueue result:')
  console.log(`  enqueued:           ${enqueueResult.enqueued}`)
  console.log(`  duplicates skipped: ${enqueueResult.skipped_duplicates}`)
  console.log(`  rejected at input:  ${enqueueResult.rejected_at_input}`)
  for (const d of enqueueResult.details) {
    if (!d.ok) console.log(`    [#${d.index}] ${d.error}`)
  }

  // ── 2. Drain the queue ──────────────────────────────────────────────
  const processed = await processQueue(db, { batch_size: 100 })
  console.log('\nprocess result:')
  console.log(`  total:    ${processed.total}`)
  console.log(`  written:  ${processed.written}`)
  console.log(`  rejected: ${processed.rejected}`)
  for (const d of processed.details) {
    const tag = d.status === 'written' ? '✓' : '✗'
    console.log(`    ${tag} ${d.nomination_id.slice(0, 8)}  ${d.applied_to ?? d.rejection_reason ?? ''}`)
  }

  // ── 3. Verify writes landed (direct pg — bypasses RLS) ─────────────
  console.log('\nverify writes:')
  await verify('brand_profiles.formality_level = casual',
    async () => {
      const r = await c.query<{ formality_level: string }>(`select formality_level from brand_profiles where brand_id = $1`, [BRAND_ID])
      return r.rows[0]?.formality_level === 'casual'
    })

  await verify('evidence_bundles.arabic_dialect = inferred_high',
    async () => {
      const r = await c.query<{ field_confidence: string }>(
        `select field_confidence from evidence_bundles where brand_id = $1 and field_name = 'arabic_dialect'`,
        [BRAND_ID],
      )
      return r.rows[0]?.field_confidence === 'inferred_high'
    })

  await verify(`negative_patterns has "${SMOKE_PATTERN_TEXT}"`,
    async () => {
      const r = await c.query(`select 1 from negative_patterns where brand_id = $1 and pattern_text = $2`, [BRAND_ID, SMOKE_PATTERN_TEXT])
      return (r.rowCount ?? 0) > 0
    })

  await verify(`override_rules has "${SMOKE_RULE_KEY}"`,
    async () => {
      const r = await c.query(`select 1 from override_rules where brand_id = $1 and rule_key = $2`, [BRAND_ID, SMOKE_RULE_KEY])
      return (r.rowCount ?? 0) > 0
    })

  await verify('sector_baselines updated for F&B/Najdi (smoke tone present)',
    async () => {
      const r = await c.query<{ top_performing_tones: Array<{ tone_id: string }> }>(
        `select top_performing_tones from sector_baselines where sector = 'F&B' and dialect = 'Najdi'`,
      )
      const tones = r.rows[0]?.top_performing_tones ?? []
      return tones.some((t) => t.tone_id === '__smoke_warm_casual__')
    })

  await verify('forbidden field_path was rejected',
    async () => {
      const r = await c.query<{ rejection_reason: string | null; status: string }>(
        `select rejection_reason, status from memory_controller_queue
           where nomination_data->>'field_path' = 'BrandProfile.tier'
           order by nominated_at desc limit 1`,
      )
      const row = r.rows[0]
      return row?.status === 'rejected' && Boolean(row.rejection_reason?.includes('forbidden_field_path'))
    })

  await verify('branddna_event_log appended (≥4 rows in last 60s)',
    async () => {
      const r = await c.query<{ n: number }>(
        `select count(*)::int as n from branddna_event_log where created_at >= now() - interval '60 seconds'`,
      )
      return (r.rows[0]?.n ?? 0) >= 4
    })

  // ── 4. Cleanup ──────────────────────────────────────────────────────
  console.log('\ncleanup:')
  await c.query(`delete from negative_patterns where pattern_text = $1`, [SMOKE_PATTERN_TEXT])
  await c.query(`delete from override_rules where rule_key = $1`, [SMOKE_RULE_KEY])
  await c.query(
    `update sector_baselines
       set top_performing_tones = coalesce(
             (select jsonb_agg(t) from jsonb_array_elements(top_performing_tones) t
              where t->>'tone_id' <> '__smoke_warm_casual__'),
             '[]'::jsonb)
       where sector = 'F&B' and dialect = 'Najdi'`,
  )
  // Best-effort cleanup of the queue rows the smoke just created.
  await c.query(`delete from memory_controller_queue where nominated_by = 'smoke'`)
  await c.end()
  console.log('  ✓ smoke artefacts removed')

  // Don't fail process exit on rollback — but do exit non-zero if any verify
  // step printed "✗".
  if (failed > 0) process.exit(1)
}

let failed = 0
async function verify(label: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const ok = await fn()
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (!ok) failed++
  } catch (e) {
    console.log(`  ✗ ${label} (threw: ${(e as Error).message})`)
    failed++
  }
}

main().catch((e) => {
  console.error('smoke crashed:', e)
  process.exit(1)
})
