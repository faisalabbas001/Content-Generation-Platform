#!/usr/bin/env node
/**
 * fix-brand.mjs — surgical fixes for an existing brand without re-running A03:
 *   1. Flip rejected queue rows back to pending so Memory can retry with new whitelist
 *   2. Link sector_baseline_id via the now-lenient linkSectorBaseline
 *   3. Convert tone_anti_attribute_ids on brand_profiles into negative_patterns
 *   4. Force a recompute of completeness_score
 */
import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const HMAC = process.env.N8N_WEBHOOK_SECRET
const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const BID = process.argv[2] || 'eb1567f8-98d6-4f28-b963-8c7f07cc2610'

console.log(`fixing brand ${BID}\n`)

// 1. Re-pend rejected nominations
const { data: rejected } = await db.from('memory_controller_queue')
  .select('nomination_id, nomination_type, nomination_data, rejection_reason')
  .eq('brand_id', BID).eq('status', 'rejected')
console.log(`Found ${rejected?.length ?? 0} rejected nominations`)
if (rejected?.length) {
  const ids = rejected.map((r) => r.nomination_id)
  const { error } = await db.from('memory_controller_queue')
    .update({ status: 'pending', rejection_reason: null, processed_at: null })
    .in('nomination_id', ids)
  console.log(`  → re-pended ${ids.length}, error=${error?.message ?? 'none'}`)
}

// 2. Drain queue via the route
console.log('\nDraining queue via /api/memory/process...')
const body = JSON.stringify({ flow_id: 'fix-brand', batch_size: 100 })
const ts = new Date().toISOString()
const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
const drainRes = await fetch(`${BASE}/api/memory/process`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-n8n-signature': sig,
    'x-n8n-request-id': crypto.randomUUID(),
    'x-n8n-timestamp': ts,
  },
  body,
})
const drainJ = await drainRes.json()
console.log(`  Memory drain: ${drainRes.status} written=${drainJ?.result?.written ?? 0} rejected=${drainJ?.result?.rejected ?? 0}`)

// 3. Link sector_baseline (lenient fallback to sector-only)
console.log('\nLinking sector_baseline...')
const { data: brand } = await db.from('brand_profiles')
  .select('sector, arabic_dialect, sector_baseline_id').eq('brand_id', BID).maybeSingle()
if (brand && !brand.sector_baseline_id) {
  let { data: baseline } = await db.from('sector_baselines')
    .select('baseline_id').eq('sector', brand.sector).eq('dialect', brand.arabic_dialect).maybeSingle()
  if (!baseline) {
    const { data: fb } = await db.from('sector_baselines')
      .select('baseline_id').eq('sector', brand.sector).limit(1).maybeSingle()
    baseline = fb
    console.log(`  no exact (${brand.sector}, ${brand.arabic_dialect}); fallback to sector-only`)
  }
  if (baseline) {
    const { error } = await db.from('brand_profiles')
      .update({ sector_baseline_id: baseline.baseline_id }).eq('brand_id', BID)
    console.log(`  linked → ${baseline.baseline_id} error=${error?.message ?? 'none'}`)
  } else {
    console.log(`  no sector_baseline found for sector=${brand.sector}`)
  }
}

// 4. Convert tone_anti_attribute_ids → negative_patterns
console.log('\nSeeding negative_patterns from tone_anti_attribute_ids...')
const { data: bp } = await db.from('brand_profiles').select('tone_anti_attribute_ids').eq('brand_id', BID).maybeSingle()
const TONE_ANTI_TO_PATTERN = {
  salesy: { pattern_text: 'Avoid hard-sell language: "buy now", "limited time", urgency framing, salesy CTAs. The brand should educate and invite, not push.', severity: 'STRONG_WARN' },
  flashy: { pattern_text: 'Avoid flashy / showy phrasing: superlatives ("the best", "amazing"), excessive emojis, exclamation chains. Tone is grounded, not loud.', severity: 'STRONG_WARN' },
  aggressive: { pattern_text: 'Avoid aggressive or confrontational language: imperatives without warmth, dismissive comparisons.', severity: 'STRONG_WARN' },
  edgy: { pattern_text: 'Avoid edgy / provocative tone: sarcasm, taboo-bordering humour, controversial cultural references.', severity: 'STRONG_WARN' },
  ironic: { pattern_text: 'Avoid ironic / sarcastic framing where intent could be misread. The brand voice is sincere.', severity: 'SOFT_WARN' },
  formal_corporate: { pattern_text: 'Avoid stiff corporate-speak: passive voice, jargon, legalistic phrasing.', severity: 'STRONG_WARN' },
  casual_humor: { pattern_text: 'Avoid casual humour / memes / slang that undermine credibility.', severity: 'STRONG_WARN' },
  western_casual: { pattern_text: 'Avoid Western casual register / Anglicisms that feel imported.', severity: 'STRONG_WARN' },
}
const tones = bp?.tone_anti_attribute_ids ?? []
let seeded = 0
for (const t of tones) {
  const m = TONE_ANTI_TO_PATTERN[t]
  if (!m) continue
  // Idempotency: skip if same pattern_text already exists for this brand
  const { data: existing } = await db.from('negative_patterns')
    .select('pattern_id').eq('brand_id', BID).eq('pattern_text', m.pattern_text).maybeSingle()
  if (existing) { console.log(`  ${t} already present, skipping`); continue }
  const { error } = await db.from('negative_patterns').insert({
    brand_id: BID, pattern_text: m.pattern_text, severity: m.severity,
  })
  if (error) console.log(`  ${t} insert FAILED: ${error.message}`)
  else { seeded++; console.log(`  ${t} seeded`) }
}
console.log(`  seeded ${seeded} patterns`)

// 5. Recompute completeness
console.log('\nRecomputing completeness...')
const { error: rpcErr } = await db.rpc('refresh_brand_completeness', { p_brand_id: BID })
console.log(`  RPC error=${rpcErr?.message ?? 'none'}`)
const { data: after } = await db.from('brand_profiles')
  .select('completeness_score, sector_baseline_id').eq('brand_id', BID).maybeSingle()
console.log(`  completeness_score=${after?.completeness_score} sector_baseline_id=${after?.sector_baseline_id}`)
