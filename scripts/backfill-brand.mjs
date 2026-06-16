#!/usr/bin/env node
/**
 * backfill-brand.mjs — apply column backfills to an existing brand:
 *   • audience_gender_mix from audience_profiles.gender_mix
 *   • onboarding_started_at from earliest source_records (form or scraper)
 *   • re-pend rejected nominations + drain
 *   • re-link sector_baseline if NULL (with sector-only fallback)
 *
 * Usage: node scripts/backfill-brand.mjs <brand_id>
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
const BID = process.argv[2]
if (!BID) { console.error('--brand-id required as first arg'); process.exit(1) }

console.log(`Backfilling brand ${BID}\n`)

// 1. audience_gender_mix backfill from audience_profiles
const { data: ap } = await db.from('audience_profiles').select('gender_mix').eq('brand_id', BID).maybeSingle()
const { data: bp } = await db.from('brand_profiles').select('audience_gender_mix, onboarding_started_at, sector_baseline_id, sector, arabic_dialect, tone_anti_attribute_ids').eq('brand_id', BID).maybeSingle()
if (!bp) { console.error('brand not found'); process.exit(1) }

if (!bp.audience_gender_mix && ap?.gender_mix) {
  const { error } = await db.from('brand_profiles').update({ audience_gender_mix: ap.gender_mix }).eq('brand_id', BID)
  console.log(`  ${error ? '✗' : '✓'} audience_gender_mix backfilled from audience_profiles${error ? ' err='+error.message : ''}`)
}

// 2. onboarding_started_at backfill
if (!bp.onboarding_started_at) {
  const { data: firstSr } = await db.from('source_records').select('captured_at').eq('brand_id', BID).order('captured_at',{ascending:true}).limit(1).maybeSingle()
  if (firstSr) {
    const { error } = await db.from('brand_profiles').update({ onboarding_started_at: firstSr.captured_at }).eq('brand_id', BID)
    console.log(`  ${error ? '✗' : '✓'} onboarding_started_at backfilled = ${firstSr.captured_at}${error ? ' err='+error.message : ''}`)
  }
}

// 3. Re-pend rejected nominations
const { data: rej } = await db.from('memory_controller_queue').select('nomination_id').eq('brand_id', BID).eq('status', 'rejected')
console.log(`  ${rej?.length ?? 0} rejected nominations`)
if (rej?.length) {
  const ids = rej.map((r) => r.nomination_id)
  await db.from('memory_controller_queue').update({ status: 'pending', rejection_reason: null, processed_at: null }).in('nomination_id', ids)
  // Drain
  const body = JSON.stringify({ flow_id: 'backfill', batch_size: 50 })
  const ts = new Date().toISOString()
  const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
  const r = await fetch(`${BASE}/api/memory/process`, {
    method: 'POST',
    headers: { 'content-type':'application/json', 'x-n8n-signature':sig, 'x-n8n-request-id':crypto.randomUUID(), 'x-n8n-timestamp':ts },
    body,
  })
  const j = await r.json()
  console.log(`  ✓ drain ${r.status} written=${j?.result?.written} rejected=${j?.result?.rejected}`)
}

// 4. sector_baseline_id link
if (!bp.sector_baseline_id && bp.sector) {
  let { data: baseline } = await db.from('sector_baselines').select('baseline_id').eq('sector', bp.sector).eq('dialect', bp.arabic_dialect).maybeSingle()
  if (!baseline) {
    const { data: fb } = await db.from('sector_baselines').select('baseline_id').eq('sector', bp.sector).limit(1).maybeSingle()
    baseline = fb
  }
  if (baseline) {
    await db.from('brand_profiles').update({ sector_baseline_id: baseline.baseline_id }).eq('brand_id', BID)
    console.log(`  ✓ sector_baseline_id linked → ${baseline.baseline_id}`)
  }
}

// 4b. channel_profiles.synced_at + is_verified/is_business backfill from raw_profile
const { data: ch } = await db.from('channel_profiles').select('channel_id, synced_at, is_business, is_verified, follows_count, raw_profile').eq('brand_id', BID)
for (const c of ch ?? []) {
  const rp = c.raw_profile ?? {}
  const patch = {}
  if (!c.synced_at) patch.synced_at = new Date().toISOString()
  // Apify field-name drift: prefer non-prefixed `verified` / `private`
  if (!c.is_verified && (rp.verified || rp.isVerified)) patch.is_verified = true
  if (!c.is_business && rp.isBusinessAccount) patch.is_business = true
  if (c.follows_count == null && typeof rp.followsCount === 'number') patch.follows_count = rp.followsCount
  if (Object.keys(patch).length === 0) continue
  const { error } = await db.from('channel_profiles').update(patch).eq('channel_id', c.channel_id)
  console.log(`  ✓ channel_profiles patched: ${Object.keys(patch).join(', ')}${error ? ' err='+error.message : ''}`)
}

// 4c. audience_profiles.age_range backfill from sector defaults
const SECTOR_AGE_DEFAULTS = {
  'F&B':              { min: 25, max: 45 },
  'Retail':           { min: 20, max: 45 },
  'Beauty_Wellness':  { min: 22, max: 40 },
  'Healthcare':       { min: 30, max: 55 },
  'Finance':          { min: 28, max: 55 },
  'Government':       { min: 25, max: 65 },
  'Other':            { min: 25, max: 50 },
}
const { data: apRow } = await db.from('audience_profiles').select('age_range').eq('brand_id', BID).maybeSingle()
if (apRow && !apRow.age_range) {
  const base = SECTOR_AGE_DEFAULTS[bp.sector ?? 'Other'] ?? SECTOR_AGE_DEFAULTS.Other
  const { data: bpAge } = await db.from('brand_profiles').select('price_position').eq('brand_id', BID).maybeSingle()
  const skew = (bpAge?.price_position === 'premium' || bpAge?.price_position === 'luxury') ? 3 : 0
  const range = { min: base.min + skew, max: base.max + (skew ? 5 : 0) }
  const { error } = await db.from('audience_profiles').update({ age_range: range }).eq('brand_id', BID)
  console.log(`  ✓ audience_profiles.age_range backfilled = ${JSON.stringify(range)}${error ? ' err='+error.message : ''}`)
}

// 4d. visual_style_profiles.platform_specs backfill
const { data: vpRow } = await db.from('visual_style_profiles').select('platform_specs').eq('brand_id', BID).maybeSingle()
if (vpRow && !vpRow.platform_specs) {
  const specs = {
    instagram: {
      feed:     { aspect_ratio: '1:1',  width: 1080, height: 1080 },
      portrait: { aspect_ratio: '4:5',  width: 1080, height: 1350 },
      story:    { aspect_ratio: '9:16', width: 1080, height: 1920 },
      reel:     { aspect_ratio: '9:16', width: 1080, height: 1920 },
      caption_max_chars: 2200,
      hashtag_max_count: 30,
    },
  }
  const { error } = await db.from('visual_style_profiles').update({ platform_specs: specs }).eq('brand_id', BID)
  console.log(`  ✓ visual_style_profiles.platform_specs backfilled${error ? ' err='+error.message : ''}`)
}

// 5. Recompute completeness
const { error: rpcErr } = await db.rpc('refresh_brand_completeness', { p_brand_id: BID })
const { data: after } = await db.from('brand_profiles').select('completeness_score, audience_gender_mix, onboarding_started_at, sector_baseline_id').eq('brand_id', BID).maybeSingle()
console.log(`\nResult: completeness=${after?.completeness_score} audience_gender_mix=${JSON.stringify(after?.audience_gender_mix)} started_at=${after?.onboarding_started_at} sector_baseline=${after?.sector_baseline_id ? '✓' : '✗'}${rpcErr ? ' rpc_err='+rpcErr.message : ''}`)
