#!/usr/bin/env node
/**
 * full-audit.mjs — every BrandDNA-related table + Qdrant for a single brand.
 * Reports NULL fields, missing rows, and verifies caption_context size.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const QURL = (process.env.QDRANT_URL || '').replace(/\/$/, '')
const QKEY = process.env.QDRANT_API_KEY
const BID = process.argv[2] || 'eb1567f8-98d6-4f28-b963-8c7f07cc2610'

console.log(`\n╔══ Full audit for brand=${BID} ══╗\n`)

function reportRow(label, value, expected, severity = 'INFO') {
  const ok = expected === undefined ? value != null : value === expected || (typeof expected === 'function' && expected(value))
  const mark = ok ? '✓' : (severity === 'ERR' ? '✗' : '⚠')
  console.log(`  ${mark} ${label.padEnd(35)} ${JSON.stringify(value)?.slice(0, 80) ?? 'null'}`)
}

// ────────────────────────────────────────────────────────────────────────
// 1. brand_profiles — every field
// ────────────────────────────────────────────────────────────────────────
const { data: bp } = await db.from('brand_profiles').select('*').eq('brand_id', BID).maybeSingle()
console.log('=== 1. brand_profiles ===')
if (!bp) { console.error('  ✗ NO ROW'); process.exit(1) }
const expectFilled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
const fields = [
  // Identity (from form)
  'brand_name_ar','brand_name_en','sector','city_primary','client_slug','logo_url','primary_color_hex',
  // Scraper inputs
  'instagram_handle','website_url','place_id',
  // Denormalised audience signal + timer
  'audience_gender_mix','onboarding_started_at',
  // 10 critical BrandDNA Lite
  'arabic_dialect','price_position','brand_differentiator','formality_level','humor_tolerance',
  'religious_sensitivity','bilingual_ratio','primary_channel','primary_kpi_type','tone_anti_attribute_ids',
  // v2 axis
  'archetype_primary','archetype_secondary','lifecycle_stage','intent_state',
  // Occasions
  'ramadan_relevance','eid_fitr_relevance','eid_adha_relevance','national_day_relevance','founding_day_relevance',
  // Audit / linkage
  'completeness_score','sector_baseline_id','vector_namespace',
  // A06 enrichment
  'engagement_baseline_likes','engagement_baseline_comments','engagement_baseline_views',
  'signature_phrases','signature_hashtags','posts_observed_count','extraction_prefill',
  // Status
  'onboarding_status','onboarding_completed_at',
]
const filledCount = fields.filter((f) => expectFilled(bp[f])).length
console.log(`  ${filledCount}/${fields.length} fields populated\n`)
for (const f of fields) {
  const v = bp[f]
  const ok = expectFilled(v)
  console.log(`    ${ok ? '✓' : '✗'} ${f.padEnd(33)} ${JSON.stringify(v)?.slice(0, 70) ?? 'null'}`)
}

// ────────────────────────────────────────────────────────────────────────
// 2. evidence_bundles
// ────────────────────────────────────────────────────────────────────────
const { data: ev } = await db.from('evidence_bundles').select('field_name, field_confidence, agreement_ratio, supporting_source_ids, last_evaluated').eq('brand_id', BID)
console.log(`\n=== 2. evidence_bundles (${ev?.length ?? 0} rows) ===`)
const CRITICAL = ['arabic_dialect','brand_differentiator','price_position','primary_channel','ramadan_relevance','primary_audience_gender','primary_kpi_type','religious_sensitivity','tone_anti_attribute_ids','bilingual_ratio','archetype_primary','lifecycle_stage']
const haveEv = new Set((ev ?? []).map((r) => r.field_name))
for (const f of CRITICAL) {
  const got = ev?.find((r) => r.field_name === f)
  console.log(`  ${got ? '✓' : '✗'} ${f.padEnd(28)} ${got?.field_confidence ?? 'MISSING'}`)
}
const missing = CRITICAL.filter((f) => !haveEv.has(f))
const qualifying = ['inferred_medium','inferred_high','evidence_weak','evidence_strong','explicitly_confirmed']
const qualified = (ev ?? []).filter((r) => qualifying.includes(r.field_confidence)).length
console.log(`  → ${qualified}/12 qualify for completeness (theoretical score = ${Math.round(qualified/12*100)})`)

// ────────────────────────────────────────────────────────────────────────
// 3. memory_controller_queue — by type/status
// ────────────────────────────────────────────────────────────────────────
const { data: mq } = await db.from('memory_controller_queue').select('nomination_type, status, rejection_reason, nomination_data').eq('brand_id', BID)
console.log(`\n=== 3. memory_controller_queue (${mq?.length ?? 0} rows) ===`)
const grouped = {}
for (const r of mq ?? []) {
  const k = `${r.nomination_type}/${r.status}`
  grouped[k] = (grouped[k] ?? 0) + 1
}
for (const [k, v] of Object.entries(grouped).sort()) console.log(`  ${k.padEnd(40)} ${v}`)
const rejected = (mq ?? []).filter((r) => r.status === 'rejected')
if (rejected.length) {
  console.log(`\n  Rejections:`)
  for (const r of rejected.slice(0, 15)) console.log(`    ${r.nomination_type}: ${r.rejection_reason}`)
}

// ────────────────────────────────────────────────────────────────────────
// 4. brand_method_profiles
// ────────────────────────────────────────────────────────────────────────
const { data: mp } = await db.from('brand_method_profiles').select('*').eq('brand_id', BID).maybeSingle()
console.log(`\n=== 4. brand_method_profiles ===`)
if (!mp) console.log('  ✗ NO ROW')
else {
  console.log(`  ✓ voice_register=${mp.voice_register} diagnostic=${mp.diagnostic_pattern}`)
  console.log(`  ✓ visual_idiom=${mp.visual_idiom} cadence=${mp.cadence_rule} closing=${mp.closing_pattern}`)
  console.log(`  ✓ composition_score=${mp.composition_score} blend=${JSON.stringify(mp.composition_blend)}`)
  console.log(`  ${mp.creative_direction_text?.length >= 50 ? '✓' : '✗'} creative_direction_text len=${mp.creative_direction_text?.length ?? 0}`)
}

// ────────────────────────────────────────────────────────────────────────
// 5. audience + visual + channels
// ────────────────────────────────────────────────────────────────────────
const { data: ap } = await db.from('audience_profiles').select('*').eq('brand_id', BID).maybeSingle()
const { data: vp } = await db.from('visual_style_profiles').select('*').eq('brand_id', BID).maybeSingle()
const { data: ch } = await db.from('channel_profiles').select('*').eq('brand_id', BID)
console.log('\n=== 5. satellite tables ===')
console.log(`  audience_profiles      gender_mix=${ap?.gender_mix ? '✓' : '✗'}  description_ar=${ap?.description_ar ? '✓' : '✗'}  age_range=${ap?.age_range ? '✓' : '✗'}  lang_pref=${ap?.language_preference ? '✓' : '✗'}`)
console.log(`  visual_style_profiles  style_descriptor=${vp?.style_descriptor ? '✓' : '✗'}  color_palette=${vp?.color_palette?.length ?? 0} hex  platform_specs=${vp?.platform_specs ? '✓' : '✗'}`)
console.log(`  channel_profiles       ${ch?.length ?? 0} rows`)
if (ch?.length) {
  for (const c of ch) console.log(`    ${c.channel} @${c.handle} ${c.followers_count} followers biz=${c.is_business} sync=${c.synced_at ? '✓' : '✗'} normalised_profile=${c.normalised_profile ? '✓' : '✗'}`)
}

// ────────────────────────────────────────────────────────────────────────
// 6. routing_decisions + confidence_classifications
// ────────────────────────────────────────────────────────────────────────
const { data: rd } = await db.from('routing_decisions').select('flow_id, confidence_mode, outcome, "timestamp"').eq('brand_id', BID).order('timestamp')
const { data: cc } = await db.from('confidence_classifications').select('mode, superseded_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== 6. routing audit chain ===`)
console.log(`  routing_decisions:        ${rd?.length ?? 0} rows`)
console.log(`  confidence_classifications: ${cc?.length ?? 0} rows`)
const active = (cc ?? []).filter((r) => !r.superseded_at)
console.log(`  active classification (superseded_at NULL): ${active.length} (should be 1)  → mode=${active[0]?.mode ?? 'NONE'}`)

// ────────────────────────────────────────────────────────────────────────
// 7. branddna_event_log
// ────────────────────────────────────────────────────────────────────────
const { data: events } = await db.from('branddna_event_log').select('event_type').eq('brand_id', BID)
console.log(`\n=== 7. branddna_event_log (${events?.length ?? 0} events) ===`)
const ev_grouped = {}
for (const e of events ?? []) ev_grouped[e.event_type] = (ev_grouped[e.event_type] ?? 0) + 1
for (const [k, v] of Object.entries(ev_grouped)) console.log(`  ${k.padEnd(28)} ${v}`)

// ────────────────────────────────────────────────────────────────────────
// 8. brand_snapshots final stage
// ────────────────────────────────────────────────────────────────────────
const { data: snap } = await db.from('brand_snapshots').select('snapshot_data, is_partial, created_at').eq('brand_id', BID).eq('is_partial', false).order('created_at',{ascending:false}).limit(1).maybeSingle()
console.log('\n=== 8. final snapshot_ready ===')
if (!snap) console.log('  ✗ NO COMPLETE SNAPSHOT')
else {
  const sd = snap.snapshot_data
  console.log(`  ✓ stage=${sd?.stage} completeness=${sd?.completeness} confidence_mode=${sd?.confidence_mode}`)
  console.log(`  ✓ archetype_primary=${sd?.archetype_primary} lifecycle=${sd?.lifecycle_stage} intent=${sd?.intent_state}`)
  console.log(`  ✓ method_name=${sd?.method_name} method_valid=${sd?.method_valid} dialect_confirmed=${sd?.dialect_confirmed}`)
  console.log(`  ✓ memory_written=${sd?.memory_written} memory_rejected=${sd?.memory_rejected}`)
}

// ────────────────────────────────────────────────────────────────────────
// 9. brand_post_observations + brand_mentions
// ────────────────────────────────────────────────────────────────────────
const { count: bpo } = await db.from('brand_post_observations').select('*', { count: 'exact', head: true }).eq('brand_id', BID)
const { count: bm } = await db.from('brand_mentions').select('*', { count: 'exact', head: true }).eq('brand_id', BID)
console.log('\n=== 9. extraction layer ===')
console.log(`  brand_post_observations:  ${bpo ?? 0} rows`)
console.log(`  brand_mentions:           ${bm ?? 0} rows`)

// ────────────────────────────────────────────────────────────────────────
// 10. usage_logs + anomalies
// ────────────────────────────────────────────────────────────────────────
const { data: ul } = await db.from('usage_logs').select('node_name, cost_usd, duration_ms, payload').eq('brand_id', BID)
const { data: an } = await db.from('anomaly_records').select('anomaly_type, resolved').eq('brand_id', BID)
console.log('\n=== 10. observability ===')
const ul_grouped = {}
let totalCost = 0
for (const r of ul ?? []) {
  ul_grouped[r.node_name] = (ul_grouped[r.node_name] ?? 0) + 1
  totalCost += Number(r.cost_usd ?? 0)
}
for (const [k, v] of Object.entries(ul_grouped).sort()) console.log(`  ${k.padEnd(20)} ${v} calls`)
console.log(`  Total cost so far: $${totalCost.toFixed(4)}`)
const failed = (ul ?? []).filter((r) => r.payload?.error)
console.log(`  Failed AI calls: ${failed.length}`)
const unresolved = (an ?? []).filter((r) => !r.resolved)
console.log(`  Unresolved anomalies: ${unresolved.length} / ${an?.length ?? 0} total`)

// ────────────────────────────────────────────────────────────────────────
// 11. negative_patterns + override_rules
// ────────────────────────────────────────────────────────────────────────
const { data: np } = await db.from('negative_patterns').select('pattern_text, severity').eq('brand_id', BID)
const { data: or } = await db.from('override_rules').select('rule_key').eq('brand_id', BID)
console.log('\n=== 11. governance ===')
console.log(`  negative_patterns: ${np?.length ?? 0} (expect ≥1 if tone_anti supplied)`)
for (const n of np ?? []) console.log(`    [${n.severity}] ${n.pattern_text.slice(0, 80)}…`)
console.log(`  override_rules:    ${or?.length ?? 0} (expect 0 unless admin added)`)

// ────────────────────────────────────────────────────────────────────────
// 12. Qdrant — namespace + caption context + onboarding seeds
// ────────────────────────────────────────────────────────────────────────
console.log('\n=== 12. Qdrant ===')
const collectionName = `brand_${BID}`
try {
  const collRes = await fetch(`${QURL}/collections/${collectionName}`, { headers: { 'api-key': QKEY }})
  if (!collRes.ok) console.log(`  ✗ collection ${collectionName} missing (status=${collRes.status})`)
  else {
    const cj = await collRes.json()
    const points = cj?.result?.points_count ?? 0
    console.log(`  ✓ collection exists  points=${points}`)
    // Scroll to find caption_context: prefix
    const scrollRes = await fetch(`${QURL}/collections/${collectionName}/points/scroll`, {
      method: 'POST',
      headers: { 'api-key': QKEY, 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 50, with_payload: true, with_vector: false }),
    })
    const sj = await scrollRes.json()
    const pts = sj?.result?.points ?? []
    const captionCtxPts = pts.filter((p) => p.payload?.kind === 'compiled_caption_context')
    const seedPts = pts.filter((p) => p.payload?.kind === 'scraped_caption')
    console.log(`  ✓ compiled_caption_context points: ${captionCtxPts.length}`)
    console.log(`  ✓ scraped_caption (onboarding seed) points: ${seedPts.length}`)
    for (const p of captionCtxPts.slice(0, 3)) {
      const len = p.payload?.caption_context?.length ?? 0
      const tc = p.payload?.token_count ?? 0
      const layers = p.payload?.layers_included ?? []
      const inRange = tc >= 800 && tc <= 1200
      console.log(`    ${inRange ? '✓' : '⚠'} ctx_len=${len} chars  token_count=${tc} (target 800-1200)  layers=${JSON.stringify(layers)}`)
    }
  }
} catch (e) {
  console.log(`  ⚠ Qdrant probe failed: ${e.message}`)
}

console.log('\n╔══ DONE ══╗')
