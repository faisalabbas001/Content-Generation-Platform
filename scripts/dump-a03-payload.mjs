#!/usr/bin/env node
/**
 * dump-a03-payload.mjs — show EXACTLY what would be sent to A03 for a brand.
 * Used to confirm form_payload + extraction lanes are all included.
 *
 * Usage:
 *   node scripts/dump-a03-payload.mjs --brand=<uuid>
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const BID = args.brand
if (!BID) { console.error('--brand=<uuid> required'); process.exit(1) }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: brand } = await db.from('brand_profiles')
  .select('brand_id, client_slug, brand_name_ar, sector, city_primary, instagram_handle, website_url, place_id')
  .eq('brand_id', BID).maybeSingle()
if (!brand) { console.error('brand not found'); process.exit(1) }

const { data: formSrc } = await db.from('source_records').select('raw_payload')
  .eq('brand_id', BID).eq('source_type', 'form')
  .order('captured_at', { ascending: false }).limit(1).maybeSingle()
const form_payload = formSrc?.raw_payload ?? {}

// What extraction lanes A03 will load (when it calls /api/extraction/source-records)
const { data: sources } = await db.from('source_records')
  .select('source_type, branch, raw, normalised, captured_at')
  .eq('brand_id', BID).order('captured_at', { ascending: false })

console.log('=== What A03 receives via webhook (Verify HMAC + parse) ===')
const a03body = {
  flow_id: 'N8N-A03',
  brand_id: brand.brand_id,
  slug: brand.client_slug,
  instagram_handle: brand.instagram_handle,
  website_url: brand.website_url,
  place_search: { name: brand.brand_name_ar, city: brand.city_primary },
  form_payload,
}
console.log(JSON.stringify(a03body, null, 2))

console.log('\n=== Critical-fields check (what Build CEO body computes) ===')
const review = form_payload.review || {}
const nonEmpty = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
const critical = {
  arabic_dialect:           nonEmpty(review.arabic_dialect),
  brand_differentiator:     nonEmpty(review.brand_differentiator) && String(review.brand_differentiator).trim().length >= 20,
  price_position:           nonEmpty(review.price_position),
  primary_channel:          nonEmpty(review.primary_channel),
  primary_kpi_type:         nonEmpty(review.primary_kpi_type),
  religious_sensitivity:    nonEmpty(review.religious_sensitivity),
  bilingual_ratio:          nonEmpty(review.bilingual_ratio),
  formality_level:          nonEmpty(review.formality_level),
  humor_tolerance:          nonEmpty(review.humor_tolerance),
  tone_anti_attribute_ids:  Array.isArray(review.tone_anti_attribute_ids) && review.tone_anti_attribute_ids.length > 0,
  ramadan_relevance:        nonEmpty(review.ramadan_relevance),
  intent_state:             nonEmpty(review.intent_state),
}
const provided = Object.values(critical).filter(Boolean).length
console.log(`provided ${provided}/12`)
for (const [k, v] of Object.entries(critical)) console.log(`  ${v ? '✓' : '✗'} ${k}`)

console.log('\n=== Extraction lanes (loaded by A03 from /api/extraction/source-records) ===')
for (const s of sources ?? []) console.log(`  ${s.source_type.padEnd(15)} branch=${(s.branch ?? '—').padEnd(10)} has_raw=${!!s.raw} has_normalised=${!!s.normalised}  @ ${s.captured_at}`)
console.log(`  → A03 will fetch these via POST /api/extraction/source-records (single call, returns consolidated shape)`)

console.log('\n=== CEO prediction ===')
if (provided >= 11) {
  console.log('  ✓ CEO should choose: Standard or Cautious')
  console.log('  → A03 should proceed to COO + Memory + snapshot_ready')
} else {
  console.log(`  ⚠ CEO may choose: Cautious (if ≥5) or Blocked (if <5). got ${provided}`)
}
