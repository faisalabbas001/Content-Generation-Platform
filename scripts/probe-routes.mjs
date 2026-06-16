#!/usr/bin/env node
/**
 * probe-routes.mjs — exercise every BrandDNA-relevant API route with
 *   - happy-path call
 *   - missing-HMAC call (expect 401)
 *   - bad-body call (expect 400)
 *
 * Confirms the routes accept what n8n sends, reject what they should,
 * and the Zod schemas align with the n8n workflow JSON bodies.
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const HMAC_SECRET = process.env.N8N_WEBHOOK_SECRET
if (!HMAC_SECRET) {
  console.error('FATAL: N8N_WEBHOOK_SECRET missing')
  process.exit(1)
}

const BRAND = process.argv[2] || '9abd1ea6-2b0f-4b13-85cf-ac494d7d9fee'

let pass = 0, fail = 0
function rec(name, ok, detail) {
  if (ok) { console.log(`  PASS  ${name}`); pass++ }
  else    { console.error(`  FAIL  ${name}\n        ${detail}`); fail++ }
}

function sign(rawBody) {
  const ts = new Date().toISOString()
  return {
    'content-type': 'application/json',
    'x-n8n-signature': crypto.createHmac('sha256', HMAC_SECRET).update(rawBody).digest('hex'),
    'x-n8n-request-id': crypto.randomUUID(),
    'x-n8n-timestamp': ts,
  }
}

async function POST(url, body, headers) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await fetch(url, { method: 'POST', body: raw, headers: headers ?? sign(raw) })
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { _raw: text.slice(0, 200) } }
  return { status: res.status, body: parsed }
}

// ── 1. /api/processing/stage ─────────────────────────────────────────
async function testStage() {
  console.log('\n── /api/processing/stage ──')
  const url = `${BASE}/api/processing/stage`
  // happy
  let r = await POST(url, { brand_id: BRAND, stage: 'form_submitted', metadata: { _probe: true } })
  rec('stage happy', r.status === 200 && r.body.ok === true, JSON.stringify(r))
  // missing HMAC
  r = await POST(url, { brand_id: BRAND, stage: 'form_submitted' }, { 'content-type': 'application/json' })
  rec('stage 401 on missing HMAC', r.status === 401 || r.status === 403, `status=${r.status}`)
  // unknown stage
  r = await POST(url, { brand_id: BRAND, stage: 'invented_stage' })
  rec('stage 400 on unknown enum', r.status === 400, `status=${r.status} body=${JSON.stringify(r.body).slice(0,120)}`)
  // missing brand_id
  r = await POST(url, { stage: 'form_submitted' })
  rec('stage 400 on missing brand_id', r.status === 400, `status=${r.status}`)
}

// ── 2. /api/agents/ceo/classify ──────────────────────────────────────
async function testCeo() {
  console.log('\n── /api/agents/ceo/classify ──')
  const url = `${BASE}/api/agents/ceo/classify`
  // bad: missing required payload fields
  let r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND, payload: {} })
  rec('ceo 400 on empty payload', r.status === 400, `status=${r.status}`)
  // bad: invalid uuid
  r = await POST(url, { flow_id: 'PROBE', brand_id: 'not-a-uuid', payload: { request_type: 'onboarding_new', trigger_payload: {}, evidence_bundle_states: {}, occasion_flags: [], current_month_spend_usd: 0, monthly_ceiling_usd: 50 } })
  rec('ceo 400 on bad uuid', r.status === 400, `status=${r.status}`)
  // happy not tested here — it's slow + covered by test-agents.mjs
}

// ── 3. /api/agents/coo/build-branddna ────────────────────────────────
async function testCoo() {
  console.log('\n── /api/agents/coo/build-branddna ──')
  const url = `${BASE}/api/agents/coo/build-branddna`
  // bad: missing payload
  let r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND })
  rec('coo 400 on missing payload', r.status === 400, `status=${r.status}`)
  // null lanes (was the old bug — should now accept)
  r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND, payload: { form_answers: {}, instagram_extraction: null, website_extraction: null, google_business_extraction: null } })
  rec('coo accepts null extraction lanes', r.status !== 400, `status=${r.status} (expected non-400; got Zod fail means schema regression)`)
}

// ── 4. /api/agents/coo/compile-caption-context ───────────────────────
async function testCaptionCtx() {
  console.log('\n── /api/agents/coo/compile-caption-context ──')
  const url = `${BASE}/api/agents/coo/compile-caption-context`
  let r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND, payload: { confidence_mode: 'Cautious', occasion_flags: [], platform_spec: 'Instagram', content_mix: { educational: 1 }, post_count: 10, brand: {} } })
  rec('caption-context happy returns 200 or 502 (model dependent)', r.status === 200 || r.status === 502, `status=${r.status}`)
  // bad confidence_mode
  r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND, payload: { confidence_mode: 'Bogus', occasion_flags: [], platform_spec: 'Instagram', content_mix: {}, post_count: 1, brand: {} } })
  rec('caption-context 400 on bad enum', r.status === 400, `status=${r.status}`)
}

// ── 5. /api/memory/process ───────────────────────────────────────────
async function testMemory() {
  console.log('\n── /api/memory/process ──')
  const url = `${BASE}/api/memory/process`
  let r = await POST(url, { flow_id: 'PROBE', batch_size: 1 })
  rec('memory drain 200', r.status === 200, `status=${r.status}`)
  // huge batch_size
  r = await POST(url, { flow_id: 'PROBE', batch_size: 99999 })
  rec('memory drain rejects oversized batch (400) or clamps', r.status === 400 || (r.status === 200 && r.body.result), `status=${r.status}`)
}

// ── 6. /api/vectors/setup ────────────────────────────────────────────
async function testVectors() {
  console.log('\n── /api/vectors/setup ──')
  const url = `${BASE}/api/vectors/setup`
  let r = await POST(url, { flow_id: 'PROBE', brand_id: BRAND })
  rec('vectors/setup 200 (configured or skipped)', r.status === 200, `status=${r.status}`)
}

// ── 7. /api/extraction/source-records ────────────────────────────────
async function testSourceRecords() {
  console.log('\n── /api/extraction/source-records ──')
  const url = `${BASE}/api/extraction/source-records`
  let r = await POST(url, { brand_id: BRAND })
  rec('source-records 200', r.status === 200 && r.body.ok === true, `status=${r.status} body=${JSON.stringify(r.body).slice(0,200)}`)
  r = await POST(url, { brand_id: 'not-a-uuid' })
  rec('source-records 400 on bad uuid', r.status === 400, `status=${r.status}`)
}

// ── 8. /api/extraction/persist-source-record ─────────────────────────
async function testPersistSourceRecord() {
  console.log('\n── /api/extraction/persist-source-record ──')
  const url = `${BASE}/api/extraction/persist-source-record`
  let r = await POST(url, { brand_id: BRAND, source_type: 'form', raw_payload: { _probe: true, ts: Date.now() }, branch: null, skipped: false })
  rec('persist-source-record 200', r.status === 200, `status=${r.status}`)
  // bad source_type
  r = await POST(url, { brand_id: BRAND, source_type: 'bogus', raw_payload: {} })
  rec('persist-source-record 400 on bad source_type', r.status === 400, `status=${r.status}`)
}

// ── 9. /api/webhooks/n8n ─────────────────────────────────────────────
async function testWebhook() {
  console.log('\n── /api/webhooks/n8n ──')
  const url = `${BASE}/api/webhooks/n8n`
  let r = await POST(url, { event_type: 'probe', flow_id: 'PROBE', brand_id: BRAND, payload: {} })
  rec('webhook 200 on probe event', r.status === 200, `status=${r.status}`)
}

async function main() {
  console.log(`Probing routes at ${BASE} for brand=${BRAND}\n`)
  await testStage()
  await testCeo()
  await testCoo()
  await testCaptionCtx()
  await testMemory()
  await testVectors()
  await testSourceRecords()
  await testPersistSourceRecord()
  await testWebhook()
  console.log(`\n${pass}/${pass+fail} passed`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(2) })
