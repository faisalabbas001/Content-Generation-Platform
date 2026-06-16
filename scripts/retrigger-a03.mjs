#!/usr/bin/env node
/**
 * retrigger-a03.mjs — re-fire N8N-A03 for an existing brand using its
 * already-stored form data from source_records.
 *
 * Use when:
 *   • A previous A03 trigger fired without form_payload (CEO blocked)
 *   • You want to test the BrandDNA build path against an existing brand
 *
 * Usage:
 *   node scripts/retrigger-a03.mjs --brand=<uuid>
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const BID = args.brand
if (!BID) {
  console.error('usage: node scripts/retrigger-a03.mjs --brand=<uuid>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HMAC = process.env.N8N_WEBHOOK_SECRET

// IMPORTANT: N8N_BASE_URL in .env points to our APP (ngrok), not to n8n.
// n8n itself defaults to localhost:5678. Use N8N_INBOUND_URL when set
// (that's the var meant to point at n8n's HTTP server), otherwise the local
// default, otherwise let the user override via --n8n=https://...
const N8N_BASE = (
  args.n8n ||
  process.env.N8N_INBOUND_URL ||
  'http://localhost:5678'
).replace(/\/$/, '')

// `/webhook/...` = production path (works whenever the flow is Active).
// `/webhook-test/...` = test mode (only active while the n8n UI is open
// and "Listen for test event" is clicked). The env var typically points
// at the test path during dev — let --test override.
const N8N_PATH = (
  args.path ||
  (args.test ? (process.env.N8N_A03_WEBHOOK_PATH ?? '/webhook-test/openclaw-onboarding')
             : '/webhook/openclaw-onboarding')
)

console.log(`[retrigger] n8n at: ${N8N_BASE}${N8N_PATH}`)
console.log(`  override with --n8n=https://... --path=/webhook/...`)
console.log(`  test-mode: add --test (requires "Listen for test event" clicked in n8n UI)\n`)

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const { data: brand, error } = await db
  .from('brand_profiles')
  .select('brand_id, client_slug, brand_name_ar, sector, city_primary, instagram_handle, website_url, place_id')
  .eq('brand_id', BID).maybeSingle()
if (error || !brand) {
  console.error(`brand ${BID} not found: ${error?.message ?? 'no row'}`)
  process.exit(1)
}

const { data: formSrc } = await db.from('source_records')
  .select('raw_payload').eq('brand_id', BID).eq('source_type', 'form')
  .order('captured_at', { ascending: false }).limit(1).maybeSingle()
const form_payload = formSrc?.raw_payload ?? {}

if (!form_payload?.review || Object.keys(form_payload.review).length === 0) {
  console.error('brand has no form review data in source_records — cannot re-trigger A03 with full payload')
  console.error('user must complete Step 3 of onboarding first')
  process.exit(1)
}

const body = JSON.stringify({
  flow_id: 'N8N-A03',
  brand_id: brand.brand_id,
  slug: brand.client_slug,
  instagram_handle: brand.instagram_handle ?? null,
  website_url: brand.website_url ?? null,
  place_search: { name: brand.brand_name_ar ?? '', city: brand.city_primary ?? '' },
  form_payload,
})

const ts = new Date().toISOString()
const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
const reqId = crypto.randomUUID()

const url = `${N8N_BASE}${N8N_PATH}`
console.log(`POST ${url}`)
console.log(`brand=${brand.brand_id} slug=${brand.client_slug}`)
console.log(`form_payload has review with ${Object.keys(form_payload.review).length} fields`)

const t0 = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-n8n-signature': sig,
    'x-n8n-request-id': reqId,
    'x-n8n-timestamp': ts,
  },
  body,
})
const text = await res.text().catch(() => '')
const elapsed = Date.now() - t0
console.log(`${res.status} in ${elapsed}ms`)
console.log(text.slice(0, 500))
console.log('\nWatch the flow in n8n UI. Then poll the DB:')
console.log(`  node scripts/smoke-test.mjs --brand=${brand.brand_id}`)
process.exit(res.ok ? 0 : 1)
