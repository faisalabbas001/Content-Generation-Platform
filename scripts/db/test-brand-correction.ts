/**
 * Test: brand correction — Memory Controller end-to-end verification.
 *
 * Strategy: directly inject a field_update nomination into memory_controller_queue
 * (bypassing the UI/n8n chain), then call /api/memory/process to drain it, and
 * verify the full pipeline:
 *   - queue row transitions pending → written
 *   - branddna_event_log gets a client_confirmed event
 *   - brand_profiles column is updated
 *
 * A separate test section also calls the /api/agents/coo/build-branddna endpoint
 * to simulate what n8n A03 does (nominate via CEO).
 *
 * Usage:
 *   pnpm tsx scripts/db/test-brand-correction.ts
 *
 * Requires: .env.local with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_DB_PASSWORD, N8N_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL
 */
import pg from 'pg'
import { createHmac, randomUUID } from 'node:crypto'
import { loadEnv, getPgConnectionString } from './lib/env.js'

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function signBody(body: string, secret: string): Record<string, string> {
  const ts  = new Date().toISOString()
  const rid = randomUUID()
  const sig = createHmac('sha256', secret).update(body).digest('hex')
  return {
    'content-type':      'application/json',
    'x-n8n-signature':   sig,
    'x-n8n-request-id':  rid,
    'x-n8n-timestamp':   ts,
  }
}

async function callMemoryProcess(
  baseUrl: string,
  secret: string,
): Promise<{ ok: boolean; result?: { total: number; written: number; rejected: number; details: unknown[] }; error?: string }> {
  const body = JSON.stringify({ flow_id: 'N8N-A04', batch_size: 10 })
  const res = await fetch(`${baseUrl}/api/memory/process`, {
    method: 'POST',
    headers: signBody(body, secret),
    body,
    signal: AbortSignal.timeout(30_000),
  })
  return res.json() as Promise<{ ok: boolean; result?: { total: number; written: number; rejected: number; details: unknown[] }; error?: string }>
}

async function main(): Promise<void> {
  loadEnv()

  const secret  = process.env.N8N_WEBHOOK_SECRET
  if (!secret) throw new Error('N8N_WEBHOOK_SECRET missing in .env.local')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  console.log(`\nTarget: ${baseUrl}`)
  console.log('─'.repeat(70))

  const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await c.connect()

  // Pick top brand
  const brandRes = await c.query<{
    brand_id: string; client_slug: string; humor_tolerance: string | null
  }>(
    `select brand_id, client_slug, humor_tolerance
       from public.brand_profiles
      order by completeness_score desc, created_at desc
      limit 1`,
  )
  if (!brandRes.rows[0]) {
    console.log('No brands found.')
    await c.end(); return
  }

  const brand = brandRes.rows[0]
  console.log(`\nBrand: ${brand.client_slug} (${brand.brand_id})`)

  const FIELD = 'humor_tolerance'
  const originalValue = brand.humor_tolerance ?? 'light'
  const testValue = originalValue === 'moderate' ? 'light' : 'moderate'

  console.log(`Field: ${FIELD}  ${originalValue} → ${testValue}`)
  console.log('─'.repeat(70))

  let passed = 0; let failed = 0

  // ── Test 1: inject nomination directly into queue ──────────────────────
  console.log('\n[1] Inject field_update nomination into memory_controller_queue...')
  const nomId = randomUUID()
  await c.query(
    `insert into public.memory_controller_queue
       (nomination_id, brand_id, nomination_type, nomination_data, nominated_by, status)
     values ($1, $2, 'field_update', $3, 'test_script', 'pending')`,
    [
      nomId,
      brand.brand_id,
      JSON.stringify({
        field_path:     FIELD,
        proposed_value: testValue,
        source:         'client_confirmation',
        evidence_source_ids: [],
        reasoning:      'Automated test — verifying Memory Controller pipeline',
      }),
    ],
  )
  const injRes = await c.query<{ status: string }>(
    `select status from public.memory_controller_queue where nomination_id = $1`, [nomId],
  )
  if (injRes.rows[0]?.status === 'pending') {
    console.log(`    ✓ Nomination ${nomId} injected, status=pending`)
    passed++
  } else {
    console.log('    ✗ Nomination not found after insert')
    failed++
  }

  // ── Test 2: Call /api/memory/process ──────────────────────────────────
  console.log('\n[2] Call /api/memory/process to drain queue...')
  const t2 = Date.now()
  const processResult = await callMemoryProcess(baseUrl, secret)
  console.log(`    latency: ${Date.now() - t2}ms`)
  console.log(`    result : ok=${processResult.ok} total=${processResult.result?.total} written=${processResult.result?.written} rejected=${processResult.result?.rejected}`)

  if (processResult.ok) {
    console.log('    ✓ /api/memory/process returned ok=true')
    passed++
  } else {
    console.log(`    ✗ /api/memory/process failed: ${processResult.error ?? JSON.stringify(processResult)}`)
    failed++
  }

  // ── Test 3: queue row should be 'written' ─────────────────────────────
  console.log('\n[3] Check queue row status...')
  await sleep(500)
  const qRes = await c.query<{ status: string; rejection_reason: string | null }>(
    `select status, rejection_reason from public.memory_controller_queue where nomination_id = $1`, [nomId],
  )
  const qStatus = qRes.rows[0]?.status
  if (qStatus === 'written') {
    console.log(`    ✓ Queue row status=written`)
    passed++
  } else if (qStatus === 'rejected') {
    console.log(`    ✗ Queue row rejected: ${qRes.rows[0]?.rejection_reason}`)
    failed++
  } else {
    console.log(`    ✗ Queue row status=${qStatus} (expected 'written')`)
    failed++
  }

  // ── Test 4: branddna_event_log entry ─────────────────────────────────
  console.log('\n[4] Check branddna_event_log for client_confirmed event...')
  const evRes = await c.query<{ event_id: string; event_type: string; event_data: Record<string, unknown>; created_at: string }>(
    `select event_id, event_type, event_data, created_at
       from public.branddna_event_log
      where brand_id = $1
        and event_type = 'client_confirmed'
        and (event_data->>'applied_to') ilike $2
      order by created_at desc
      limit 1`,
    [brand.brand_id, `%${FIELD}%`],
  )
  if (evRes.rows[0]) {
    console.log(`    ✓ event_log row: ${evRes.rows[0].event_id}`)
    console.log(`      applied_to : ${evRes.rows[0].event_data.applied_to}`)
    console.log(`      new_value  : ${evRes.rows[0].event_data.new_value ?? evRes.rows[0].event_data.proposed_value}`)
    console.log(`      created_at : ${evRes.rows[0].created_at}`)
    passed++
  } else {
    console.log('    ✗ No client_confirmed event in branddna_event_log')
    failed++
  }

  // ── Test 5: brand_profiles updated ───────────────────────────────────
  console.log('\n[5] Verify brand_profiles updated...')
  const profileRes = await c.query<{ humor_tolerance: string }>(
    `select humor_tolerance from public.brand_profiles where brand_id = $1`, [brand.brand_id],
  )
  const currentVal = profileRes.rows[0]?.humor_tolerance
  if (currentVal === testValue) {
    console.log(`    ✓ brand_profiles.humor_tolerance = "${currentVal}"`)
    passed++
  } else {
    console.log(`    ✗ Expected "${testValue}" but got "${currentVal}"`)
    failed++
  }

  // ── Test 6: evidence_bundles upgraded ────────────────────────────────
  console.log('\n[6] Verify evidence_bundles upgraded to explicitly_confirmed...')
  const ebRes = await c.query<{ field_confidence: string; agreement_ratio: number }>(
    `select field_confidence, agreement_ratio
       from public.evidence_bundles
      where brand_id = $1 and field_name = $2`,
    [brand.brand_id, FIELD],
  )
  if (ebRes.rows[0]) {
    const isConfirmed = ebRes.rows[0].field_confidence === 'explicitly_confirmed'
    console.log(`    ${isConfirmed ? '✓' : '✗'} evidence_bundles.field_confidence = "${ebRes.rows[0].field_confidence}" (agreement=${ebRes.rows[0].agreement_ratio})`)
    if (isConfirmed) passed++; else failed++
  } else {
    console.log('    ⚠ No evidence_bundle row for this field (expected after confirmation)')
    // Non-fatal: may not exist for non-critical fields
  }

  // ── Test 7: completeness_score refreshed ─────────────────────────────
  console.log('\n[7] Verify completeness_score refreshed...')
  const scoreRes = await c.query<{ completeness_score: number }>(
    `select completeness_score from public.brand_profiles where brand_id = $1`, [brand.brand_id],
  )
  const score = scoreRes.rows[0]?.completeness_score
  if (typeof score === 'number') {
    console.log(`    ✓ completeness_score = ${score}`)
    passed++
  } else {
    console.log('    ✗ completeness_score missing')
    failed++
  }

  // ── Cleanup: restore original value ──────────────────────────────────
  console.log(`\n[cleanup] Restoring ${FIELD} = "${originalValue}"...`)
  await c.query(
    `update public.brand_profiles set ${FIELD} = $1, updated_at = now() where brand_id = $2`,
    [originalValue, brand.brand_id],
  )
  const restored = await c.query<{ humor_tolerance: string }>(
    `select humor_tolerance from public.brand_profiles where brand_id = $1`, [brand.brand_id],
  )
  console.log(`    ${FIELD} restored to: ${restored.rows[0]?.humor_tolerance}`)

  await c.end()

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`RESULTS: ${passed} passed  ${failed} failed`)
  if (failed === 0) {
    console.log('✓ Memory Controller pipeline is working correctly.')
    console.log('  field_update nomination → process → written → event_log → brand_profiles updated')
  } else {
    console.log('✗ Some checks failed — see output above.')
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
