#!/usr/bin/env node
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BID = process.argv[2] || 'eb1567f8-98d6-4f28-b963-8c7f07cc2610'

console.log(`brand=${BID}\n`)

// 1. brand_profiles full row
const { data: bp } = await db.from('brand_profiles').select('*').eq('brand_id', BID).maybeSingle()
console.log('=== brand_profiles (key v2 columns) ===')
console.log({
  completeness_score: bp?.completeness_score,
  archetype_primary: bp?.archetype_primary,
  archetype_secondary: bp?.archetype_secondary,
  lifecycle_stage: bp?.lifecycle_stage,
  intent_state: bp?.intent_state,
  sector_baseline_id: bp?.sector_baseline_id,
  vector_namespace: bp?.vector_namespace,
  onboarding_status: bp?.onboarding_status,
})

// 2. evidence_bundles
const { data: ev } = await db.from('evidence_bundles').select('field_name, field_confidence, agreement_ratio, last_evaluated').eq('brand_id', BID).order('field_name')
console.log(`\n=== evidence_bundles (${ev?.length ?? 0} rows) ===`)
for (const r of ev ?? []) console.log(` ${r.field_name.padEnd(28)} ${r.field_confidence}`)

// 3. memory_controller_queue counts by status × type
const { data: mq } = await db.from('memory_controller_queue').select('nomination_type, status, rejection_reason').eq('brand_id', BID)
console.log(`\n=== memory_controller_queue (${mq?.length ?? 0} rows) ===`)
const grouped = {}
for (const r of mq ?? []) {
  const k = `${r.nomination_type}/${r.status}`
  grouped[k] = (grouped[k] ?? 0) + 1
}
for (const [k, v] of Object.entries(grouped).sort()) console.log(` ${k.padEnd(40)} ${v}`)
// Rejections
const rejected = (mq ?? []).filter((r) => r.status === 'rejected')
if (rejected.length) {
  console.log('\n  Rejections (first 10):')
  for (const r of rejected.slice(0, 10)) console.log(`    ${r.nomination_type}: ${r.rejection_reason}`)
}

// 4. brand_method_profiles
const { data: mp } = await db.from('brand_method_profiles').select('voice_register, visual_idiom, cadence_rule, closing_pattern, composition_score, composition_blend, creative_direction_text').eq('brand_id', BID).maybeSingle()
console.log('\n=== brand_method_profiles ===')
if (mp) {
  console.log({
    voice_register: mp.voice_register,
    visual_idiom: mp.visual_idiom,
    cadence_rule: mp.cadence_rule,
    closing_pattern: mp.closing_pattern,
    composition_score: mp.composition_score,
    composition_blend: mp.composition_blend,
    creative_direction_text_len: mp.creative_direction_text?.length ?? 0,
  })
} else {
  console.log('NULL — COO method_profile_update never written')
}

// 5. confidence_classifications
const { data: cc } = await db.from('confidence_classifications').select('mode, reasons, created_at, superseded_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== confidence_classifications (${cc?.length ?? 0} rows) ===`)
for (const r of cc ?? []) console.log(` ${r.created_at} mode=${r.mode} superseded=${r.superseded_at ? 'yes' : 'no'} reasons=${JSON.stringify(r.reasons)}`)

// 6. routing_decisions
const { data: rd } = await db.from('routing_decisions').select('decision_id, flow_id, confidence_mode, outcome, "timestamp"').eq('brand_id', BID).order('timestamp')
console.log(`\n=== routing_decisions (${rd?.length ?? 0} rows) ===`)
for (const r of rd ?? []) console.log(` ${r.timestamp} ${r.flow_id} mode=${r.confidence_mode} outcome=${r.outcome}`)

// 7. brand_snapshots — stage chain
const { data: snaps } = await db.from('brand_snapshots').select('is_partial, snapshot_data, created_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== brand_snapshots stage chain (${snaps?.length ?? 0} rows) ===`)
for (const s of snaps ?? []) {
  const sd = s.snapshot_data || {}
  console.log(` ${s.created_at} partial=${s.is_partial} stage=${sd.stage}${sd.confidence_mode ? ' mode='+sd.confidence_mode : ''}${sd.completeness != null ? ' completeness='+sd.completeness : ''}`)
}

// 8. branddna_event_log
const { data: events } = await db.from('branddna_event_log').select('event_type, event_data, created_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== branddna_event_log (${events?.length ?? 0} rows) ===`)
for (const e of events ?? []) console.log(` ${e.created_at} ${e.event_type}`)

// 9. usage_logs by node
const { data: ul } = await db.from('usage_logs').select('node_name, duration_ms, cost_usd, payload, created_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== usage_logs (${ul?.length ?? 0} rows) ===`)
for (const r of ul ?? []) {
  const err = r.payload?.error
  console.log(` ${r.created_at} ${r.node_name.padEnd(20)} ${r.duration_ms ?? 0}ms cost=${r.cost_usd ?? 0}${err ? ' ERR:'+err.name+': '+err.message : ''}`)
}

// 10. anomaly_records
const { data: an } = await db.from('anomaly_records').select('anomaly_type, severity, details, resolved, created_at').eq('brand_id', BID).order('created_at')
console.log(`\n=== anomaly_records (${an?.length ?? 0} rows) ===`)
for (const r of an ?? []) console.log(` ${r.created_at} ${r.anomaly_type}/${r.severity} resolved=${r.resolved} details=${JSON.stringify(r.details).slice(0, 200)}`)

// 11. source_records
const { data: sr } = await db.from('source_records').select('source_type, branch, captured_at').eq('brand_id', BID).order('captured_at')
console.log(`\n=== source_records (${sr?.length ?? 0} rows) ===`)
for (const r of sr ?? []) console.log(` ${r.captured_at} ${r.source_type} (${r.branch ?? '-'})`)

// 12. audience / visual / channels
const { data: ap } = await db.from('audience_profiles').select('*').eq('brand_id', BID).maybeSingle()
const { data: vp } = await db.from('visual_style_profiles').select('*').eq('brand_id', BID).maybeSingle()
const { data: ch } = await db.from('channel_profiles').select('channel, handle, followers_count, is_business').eq('brand_id', BID)
console.log('\n=== satellites ===')
console.log('  audience_profiles:', ap ? { gender_mix: ap.gender_mix, age_range: ap.age_range, description_ar: ap.description_ar?.slice(0, 80), language_preference: ap.language_preference } : 'NULL')
console.log('  visual_style_profiles:', vp ? { style_descriptor: vp.style_descriptor?.slice(0, 80), color_palette: vp.color_palette } : 'NULL')
console.log('  channel_profiles:', ch?.length ?? 0, 'rows')

// 13. brand_method_profile_history
const { data: hist } = await db.from('brand_method_profile_history').select('change_reason, composition_score, changed_at').eq('brand_id', BID).order('changed_at')
console.log(`\n=== brand_method_profile_history (${hist?.length ?? 0} rows) ===`)
for (const r of hist ?? []) console.log(` ${r.changed_at} ${r.change_reason} score=${r.composition_score}`)

// 14. brand_post_observations
const { count: bpo } = await db.from('brand_post_observations').select('*', { count: 'exact', head: true }).eq('brand_id', BID)
console.log(`\n=== brand_post_observations: ${bpo} rows ===`)
