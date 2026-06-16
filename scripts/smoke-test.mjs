#!/usr/bin/env node
/**
 * smoke-test.mjs — pre-deploy sanity check for the BrandDNA pipeline.
 *
 * NOT a unit-test runner. NOT a full integration suite. This is a
 * single-shot script that:
 *
 *   1. Loads .env.local and verifies required vars are set.
 *   2. Connects to Supabase with service-role + admin SELECT permission.
 *   3. Walks 25 invariants the pipeline depends on. Each is a single small
 *      query that should return a specific shape — if it errors or returns
 *      unexpected data, we print FAIL + exit non-zero.
 *
 * Run from repo root:
 *   node scripts/smoke-test.mjs
 *
 * Or to scope to a single brand:
 *   node scripts/smoke-test.mjs --brand=<uuid>
 *
 * The intent: when someone runs migrations, edits prompts, or touches the
 * COO/Memory wiring, this catches the obvious breakages in <5s without
 * needing a real onboarding run.
 */

import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

// ── 1. Env vars ──────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APIFY_API_KEY',
  'ANTHROPIC_API_KEY',
  'N8N_WEBHOOK_SECRET',
]
const MISSING_ENV = REQUIRED_ENV.filter((k) => !process.env[k])
if (MISSING_ENV.length > 0) {
  console.error(`[smoke] FAIL — missing env vars: ${MISSING_ENV.join(', ')}`)
  process.exit(1)
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── 2. Parse args ────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const scopedBrandId = typeof args.brand === 'string' ? args.brand : null

// ── 3. Invariants ────────────────────────────────────────────────────
const checks = []
function check(name, fn) { checks.push({ name, fn }) }

// Schema: composition_matrix should be seeded with 300 rows (12 × 5 × 5)
check('composition_matrix seeded (300 rows)', async () => {
  const { count, error } = await db.from('composition_matrix').select('*', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  if (count !== 300) throw new Error(`expected 300 rows, got ${count}`)
})

// Schema: critical brand_profiles columns exist
check('brand_profiles has v2 + audit columns', async () => {
  const REQUIRED_COLS = ['archetype_primary','archetype_secondary','lifecycle_stage','intent_state','vector_namespace','sector_baseline_id','place_id']
  const { data, error } = await db.from('brand_profiles').select(REQUIRED_COLS.join(',')).limit(1)
  if (error) throw new Error(`select probe failed: ${error.message}`)
  void data
})

// Schema: enum nomination types includes method_profile_update
check('memory_controller_queue accepts method_profile_update', async () => {
  // We can't introspect enums via Supabase REST, but a single insert + rollback would mutate.
  // Instead probe via the queue and look for any existing row of that type — a passing onboarding will have one.
  const { error } = await db.from('memory_controller_queue').select('nomination_id').eq('nomination_type', 'method_profile_update').limit(1)
  if (error) throw new Error(`memory_controller_queue probe failed: ${error.message}`)
})

// Schema: anomaly_records has the composition_score_below_floor type used by COO route
check('anomaly_records accepts composition_score_below_floor', async () => {
  const { error } = await db.from('anomaly_records').select('anomaly_id').eq('anomaly_type', 'composition_score_below_floor').limit(1)
  if (error) throw new Error(`anomaly_records probe failed: ${error.message}`)
})

// Schema: onboarding_questions seeded
check('onboarding_questions seeded', async () => {
  const { count, error } = await db.from('onboarding_questions').select('*', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  if (!count || count < 10) throw new Error(`expected ≥10 questions, got ${count}`)
})

// Schema: sector_baselines seeded for the canonical sectors
check('sector_baselines has F&B entry', async () => {
  const { data, error } = await db.from('sector_baselines').select('baseline_id').eq('sector', 'F&B').limit(1)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('no F&B baseline row')
})

// Smoke: V01 enrichment dependencies — visual_style_profiles and method_profile
// columns exist and are queryable. Catches a missing migration that would
// break /api/image/generate's server-side enrichment.
check('visual_style_profiles has style_descriptor + color_palette', async () => {
  const { error } = await db.from('visual_style_profiles').select('style_descriptor, color_palette').limit(1)
  if (error) throw new Error(error.message)
})
check('brand_method_profiles has visual_idiom + composition_score', async () => {
  const { error } = await db.from('brand_method_profiles').select('visual_idiom, composition_score').limit(1)
  if (error) throw new Error(error.message)
})

// Live-data invariants (scoped to a brand if --brand= was passed)
if (scopedBrandId) {
  check(`brand ${scopedBrandId} exists`, async () => {
    const { data, error } = await db.from('brand_profiles').select('brand_id').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('not found')
  })
  check(`brand ${scopedBrandId} has at least 4 source_records`, async () => {
    const { count, error } = await db.from('source_records').select('*', { count: 'exact', head: true }).eq('brand_id', scopedBrandId)
    if (error) throw new Error(error.message)
    if (!count || count < 4) throw new Error(`expected ≥4, got ${count}`)
  })
  check(`brand ${scopedBrandId} has evidence_bundles populated`, async () => {
    const { count, error } = await db.from('evidence_bundles').select('*', { count: 'exact', head: true }).eq('brand_id', scopedBrandId)
    if (error) throw new Error(error.message)
    if (!count || count < 8) throw new Error(`expected ≥8 evidence rows, got ${count} — Memory Controller may not have drained`)
  })
  check(`brand ${scopedBrandId} method_profile exists`, async () => {
    const { data, error } = await db.from('brand_method_profiles').select('voice_register, composition_score').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('no method_profile')
  })
  check(`brand ${scopedBrandId} v2 axis fields filled`, async () => {
    const { data, error } = await db.from('brand_profiles').select('archetype_primary, lifecycle_stage, intent_state').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data?.archetype_primary || !data?.lifecycle_stage || !data?.intent_state) {
      throw new Error(`missing: ${JSON.stringify(data)}`)
    }
  })
  check(`brand ${scopedBrandId} completeness_score ≥ 50`, async () => {
    const { data, error } = await db.from('brand_profiles').select('completeness_score').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || data.completeness_score < 50) throw new Error(`expected ≥50, got ${data?.completeness_score}`)
  })
  check(`brand ${scopedBrandId} method composition_score ≥ floor`, async () => {
    const { data, error } = await db.from('brand_method_profiles').select('composition_score').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('no method_profile')
    if (data.composition_score < 60) {
      // Not an automatic fail — just flag. A sub-floor brand should have an anomaly row.
      const { data: anom } = await db.from('anomaly_records').select('anomaly_id').eq('brand_id', scopedBrandId).eq('anomaly_type', 'composition_score_below_floor').limit(1)
      if (!anom || anom.length === 0) throw new Error(`composition_score=${data.composition_score} but no anomaly row was written`)
    }
  })
  check(`brand ${scopedBrandId} sector_baseline linked`, async () => {
    const { data, error } = await db.from('brand_profiles').select('sector_baseline_id').eq('brand_id', scopedBrandId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data?.sector_baseline_id) throw new Error('sector_baseline_id is NULL — linkSectorBaseline did not run')
  })
  check(`brand ${scopedBrandId} branddna_event_log populated`, async () => {
    const { count, error } = await db.from('branddna_event_log').select('*', { count: 'exact', head: true }).eq('brand_id', scopedBrandId)
    if (error) throw new Error(error.message)
    if (!count || count < 3) throw new Error(`expected ≥3 events, got ${count}`)
  })
}

// ── 4. Run ───────────────────────────────────────────────────────────
let passed = 0
let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.error(`  FAIL  ${name}\n        ${e.message}`)
    failed++
  }
}

console.log(`\n${passed}/${passed + failed} passed${failed > 0 ? ` (${failed} failed)` : ''}`)
process.exit(failed > 0 ? 1 : 0)
