#!/usr/bin/env node
/**
 * test-agents.mjs — manual CLI agent tester.
 *
 * Picks an existing brand from the DB (or one you specify), pulls its
 * already-extracted form_payload + source_records, and calls the agent
 * routes directly with HMAC signing — exactly the way n8n would. Lets you
 * verify CEO → COO → Memory drain end-to-end WITHOUT triggering a real n8n
 * flow or re-running scrapers.
 *
 * Usage (run from repo root):
 *
 *   node scripts/test-agents.mjs                       # pick most-recent complete brand
 *   node scripts/test-agents.mjs --brand=<uuid>        # specific brand
 *   node scripts/test-agents.mjs --agents=ceo,coo      # run subset
 *   node scripts/test-agents.mjs --dry-run             # show what we'd send, don't fire
 *   node scripts/test-agents.mjs --base=https://...    # override APP_BASE_URL
 *
 * What it does:
 *   1. Loads a brand's form_payload from source_records (type='form')
 *      AND its extraction lanes (instagram/website/places).
 *   2. Calls CEO classify with the real trigger payload.
 *   3. Reads CEO decision; if Cautious/Standard, calls COO build-branddna.
 *   4. Calls Memory process to drain.
 *   5. Re-reads brand_profiles + evidence_bundles + brand_method_profiles
 *      and reports what changed.
 *   6. Optionally calls compile-caption-context to verify A01 path.
 *
 * Hard Rule: this is a DIAGNOSTIC tool. It uses the real Memory Controller
 * queue and DOES write Layer 1 tables (via the same path agents use). So
 * running it against a production brand will update that brand's BrandDNA.
 * Use a test brand or accept that you're refreshing the real one.
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HMAC_SECRET  = process.env.N8N_WEBHOOK_SECRET

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))

const BASE = (typeof args.base === 'string' ? args.base : process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const DRY_RUN = !!args['dry-run']
const ENABLED_AGENTS = typeof args.agents === 'string' ? new Set(args.agents.split(',').map((s) => s.trim())) : new Set(['ceo', 'coo', 'memory', 'caption-context'])

if (!SUPABASE_URL || !SUPABASE_KEY || !HMAC_SECRET) {
  console.error('[test-agents] FAIL — missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / N8N_WEBHOOK_SECRET')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Helpers ──────────────────────────────────────────────────────────
function hmacSign(rawBody) {
  const ts = new Date().toISOString()
  const reqId = crypto.randomUUID()
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(rawBody).digest('hex')
  return {
    'content-type': 'application/json',
    'x-n8n-signature': sig,
    'x-n8n-request-id': reqId,
    'x-n8n-timestamp': ts,
  }
}

async function callRoute(name, urlPath, body) {
  const raw = JSON.stringify(body)
  const headers = hmacSign(raw)
  const url = `${BASE}${urlPath}`
  console.log(`\n→ ${name}: POST ${url}`)
  if (DRY_RUN) {
    console.log('  (dry-run — body preview):')
    console.log('  ' + raw.slice(0, 400) + (raw.length > 400 ? '…' : ''))
    return { dryRun: true }
  }
  const t0 = Date.now()
  const res = await fetch(url, { method: 'POST', headers, body: raw })
  const elapsed = Date.now() - t0
  const text = await res.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { _raw: text.slice(0, 200) } }
  console.log(`  ← ${res.status} in ${elapsed}ms`)
  if (!res.ok) {
    console.error('  ✗ ' + JSON.stringify(parsed).slice(0, 600))
  } else {
    console.log('  ✓ ' + JSON.stringify(parsed).slice(0, 400))
  }
  return { status: res.status, body: parsed, elapsed }
}

// ── Pick a brand ─────────────────────────────────────────────────────
async function pickBrand() {
  if (typeof args.brand === 'string') {
    const { data, error } = await db.from('brand_profiles').select('*').eq('brand_id', args.brand).maybeSingle()
    if (error || !data) {
      console.error(`[test-agents] brand ${args.brand} not found: ${error?.message ?? 'no row'}`)
      process.exit(1)
    }
    return data
  }
  // Default: pick the most recent complete onboarding so we know all the
  // upstream data (form + extractions) is in place.
  const { data, error } = await db.from('brand_profiles')
    .select('*')
    .eq('onboarding_status', 'complete')
    .order('onboarding_completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    console.error('[test-agents] no completed brand found — pass --brand=<uuid>')
    process.exit(1)
  }
  return data
}

// ── Build payloads from existing data ─────────────────────────────────
async function buildPayloads(brand) {
  const bid = brand.brand_id
  // Form data — stored as raw_payload on source_records.type=form
  const { data: formSrc } = await db.from('source_records')
    .select('*').eq('brand_id', bid).eq('source_type', 'form')
    .order('captured_at', { ascending: false }).limit(1).maybeSingle()
  const form_payload = formSrc?.raw_payload ?? {}

  // Extraction lanes — pull the normalised summaries written by A06
  const { data: sources } = await db.from('source_records')
    .select('source_type, normalised, raw, branch')
    .eq('brand_id', bid).order('captured_at', { ascending: false })
  const byBranch = { instagram: null, website: null, places: null }
  for (const s of sources ?? []) {
    if (s.branch === 'instagram' && !byBranch.instagram) byBranch.instagram = s.normalised
    if (s.branch === 'website'   && !byBranch.website)   byBranch.website   = s.normalised
    if (s.branch === 'places'    && !byBranch.places)    byBranch.places    = s.normalised
  }

  // Data-richness heuristic (mirrors A03's Consolidate extractions node)
  const sourcesCount = (byBranch.instagram ? 1 : 0) + (byBranch.website ? 1 : 0) + (byBranch.places ? 1 : 0)
  const data_richness = sourcesCount === 0 ? 'form_only' : sourcesCount === 1 ? 'single_source' : sourcesCount === 2 ? 'partial' : 'rich'
  const is_pre_launch = sourcesCount === 0

  // form_payload may be flat (Tazaj seed shape) OR nested under .review (v2
  // server-action shape). Normalise: prefer .review when populated, fall
  // back to the flat form_payload. Either way, downstream readers find
  // arabic_dialect / primary_channel / etc.
  const nestedReview = (form_payload.review && typeof form_payload.review === 'object') ? form_payload.review : null
  const review = nestedReview && Object.keys(nestedReview).length > 0 ? nestedReview : form_payload

  return {
    brand_id: bid,
    form_payload,
    extractions: byBranch,
    data_richness,
    is_pre_launch,
    review,
  }
}

// ── CEO ──────────────────────────────────────────────────────────────
async function runCeo(state) {
  if (!ENABLED_AGENTS.has('ceo')) return null
  const review = state.review || {}
  const criticalFieldsProvided = {
    arabic_dialect:        !!review.arabic_dialect,
    brand_differentiator:  !!review.brand_differentiator,
    primary_kpi_type:      !!review.primary_kpi_type,
    primary_channel:       !!review.primary_channel,
    intent_state:          !!review.intent_state,
    formality_level:       !!review.formality_level,
    humor_tolerance:       !!review.humor_tolerance,
    religious_sensitivity: !!review.religious_sensitivity,
    bilingual_ratio:       !!review.bilingual_ratio,
    price_position:        !!review.price_position,
  }
  const body = {
    flow_id: 'TEST-AGENTS',
    brand_id: state.brand_id,
    payload: {
      request_type: 'onboarding_new',
      trigger_payload: {
        pass: 'pre_coo',
        slug: 'test',
        critical_fields_provided: criticalFieldsProvided,
        data_richness: state.data_richness,
        is_pre_launch: state.is_pre_launch,
      },
      evidence_bundle_states: {},
      occasion_flags: ['none'],
      current_month_spend_usd: 0,
      monthly_ceiling_usd: 50,
    },
  }
  const r = await callRoute('CEO classify', '/api/agents/ceo/classify', body)
  return r
}

// ── COO ──────────────────────────────────────────────────────────────
async function runCoo(state) {
  if (!ENABLED_AGENTS.has('coo')) return null
  const review = state.review || {}
  const body = {
    flow_id: 'TEST-AGENTS',
    brand_id: state.brand_id,
    payload: {
      form_answers: state.form_payload,
      instagram_extraction: state.extractions.instagram,
      website_extraction:   state.extractions.website,
      google_business_extraction: state.extractions.places,
      request_axes: { archetype_primary: true, archetype_secondary: true, lifecycle_stage: true, intent_state: true },
      method_profile_request: { compose: true, default_method: state.is_pre_launch ? 'Vulnerability' : null, score_threshold: 80 },
      data_richness: state.data_richness,
      is_pre_launch: state.is_pre_launch,
      form_dialect: review.arabic_dialect ?? null,
      form_priors: {
        archetype_primary:        review.archetype_primary ?? null,
        lifecycle_stage:          review.lifecycle_stage ?? null,
        intent_state:             review.intent_state ?? null,
        primary_kpi_type:         review.primary_kpi_type ?? null,
        primary_channel:          review.primary_channel ?? null,
        bilingual_ratio:          review.bilingual_ratio ?? null,
        formality_level:          review.formality_level ?? null,
        humor_tolerance:          review.humor_tolerance ?? null,
        religious_sensitivity:    review.religious_sensitivity ?? null,
        ramadan_relevance:        review.ramadan_relevance ?? null,
        tone_anti_attribute_ids:  review.tone_anti_attribute_ids ?? null,
        price_position:           review.price_position ?? null,
        brand_differentiator:     review.brand_differentiator ?? null,
      },
    },
  }
  return await callRoute('COO build-branddna', '/api/agents/coo/build-branddna', body)
}

// ── Memory drain ──────────────────────────────────────────────────────
async function runMemory() {
  if (!ENABLED_AGENTS.has('memory')) return null
  return await callRoute('Memory drain', '/api/memory/process', { flow_id: 'TEST-AGENTS', batch_size: 100 })
}

// ── Caption context (A01 path) ────────────────────────────────────────
async function runCaptionContext(state) {
  if (!ENABLED_AGENTS.has('caption-context')) return null
  const body = {
    flow_id: 'TEST-AGENTS',
    brand_id: state.brand_id,
    payload: {
      confidence_mode: 'Cautious',
      occasion_flags: [],
      platform_spec: 'Instagram',
      content_mix: { educational: 0.3, experiential: 0.4, promotional: 0.3 },
      post_count: 20,
    },
  }
  return await callRoute('COO compile-caption-context', '/api/agents/coo/compile-caption-context', body)
}

// ── Verify DB after ───────────────────────────────────────────────────
async function verifyAfter(bid, snapshotBefore) {
  console.log('\n=== Post-run verification ===')
  // vector_namespace was added in migration 0030 — some envs may not have it
  // applied yet. Select the core set; fall back without vector_namespace on
  // schema-cache miss so the test isn't blocked by a missing migration.
  let brand
  let brandErr
  {
    const r = await db.from('brand_profiles')
      .select('archetype_primary, archetype_secondary, lifecycle_stage, intent_state, completeness_score, sector_baseline_id, vector_namespace')
      .eq('brand_id', bid).maybeSingle()
    brand = r.data
    brandErr = r.error
  }
  if (brandErr && /vector_namespace/.test(brandErr.message)) {
    console.warn('[test-agents] migration 0030 (vector_namespace) is not applied yet — selecting without it')
    const r = await db.from('brand_profiles')
      .select('archetype_primary, archetype_secondary, lifecycle_stage, intent_state, completeness_score, sector_baseline_id')
      .eq('brand_id', bid).maybeSingle()
    brand = r.data
    brandErr = r.error
  }
  if (brandErr) console.warn(`[test-agents] brand select failed: ${brandErr.message}`)
  const { count: evidenceCount } = await db.from('evidence_bundles').select('*', { count: 'exact', head: true }).eq('brand_id', bid)
  const { count: queueCount }    = await db.from('memory_controller_queue').select('*', { count: 'exact', head: true }).eq('brand_id', bid)
  const { count: writtenCount }  = await db.from('memory_controller_queue').select('*', { count: 'exact', head: true }).eq('brand_id', bid).eq('status', 'written')
  const { data: method }         = await db.from('brand_method_profiles').select('voice_register, visual_idiom, cadence_rule, composition_score, creative_direction_text').eq('brand_id', bid).maybeSingle()
  console.log('brand_profiles v2 fields:', brand)
  console.log(`evidence_bundles rows: ${evidenceCount} (was ${snapshotBefore.evidenceCount})`)
  console.log(`memory_controller_queue: ${writtenCount}/${queueCount} written (was ${snapshotBefore.writtenCount}/${snapshotBefore.queueCount})`)
  console.log('brand_method_profiles:', method)

  console.log('\nVerdict:')
  const checks = []
  checks.push({ name: 'completeness_score ≥ 50', pass: (brand?.completeness_score ?? 0) >= 50 })
  checks.push({ name: 'archetype_primary set',   pass: !!brand?.archetype_primary })
  checks.push({ name: 'lifecycle_stage set',     pass: !!brand?.lifecycle_stage })
  checks.push({ name: 'intent_state set',        pass: !!brand?.intent_state })
  checks.push({ name: 'evidence_bundles ≥ 8',    pass: (evidenceCount ?? 0) >= 8 })
  checks.push({ name: 'method_profile exists',   pass: !!method })
  checks.push({ name: 'method.composition_score ≥ 60', pass: (method?.composition_score ?? 0) >= 60 })
  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`)
  return checks.every((c) => c.pass)
}

async function snapshotBefore(bid) {
  const { count: evidenceCount } = await db.from('evidence_bundles').select('*', { count: 'exact', head: true }).eq('brand_id', bid)
  const { count: queueCount }    = await db.from('memory_controller_queue').select('*', { count: 'exact', head: true }).eq('brand_id', bid)
  const { count: writtenCount }  = await db.from('memory_controller_queue').select('*', { count: 'exact', head: true }).eq('brand_id', bid).eq('status', 'written')
  return { evidenceCount: evidenceCount ?? 0, queueCount: queueCount ?? 0, writtenCount: writtenCount ?? 0 }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`[test-agents] BASE=${BASE}  DRY_RUN=${DRY_RUN}  agents=[${[...ENABLED_AGENTS].join(',')}]`)
  const brand = await pickBrand()
  console.log(`[test-agents] brand=${brand.brand_id}  slug=${brand.client_slug}  name="${brand.brand_name_en ?? brand.brand_name_ar}"`)

  const state = await buildPayloads(brand)
  const hasFormFields = !!(state.review && (state.review.arabic_dialect || state.review.brand_differentiator || state.review.primary_kpi_type))
  console.log(`[test-agents] data_richness=${state.data_richness}  pre_launch=${state.is_pre_launch}  has_form=${hasFormFields}`)

  const before = await snapshotBefore(brand.brand_id)
  console.log(`[test-agents] before: evidence=${before.evidenceCount} queue=${before.queueCount} written=${before.writtenCount}`)

  await runCeo(state)
  await runCoo(state)
  await runMemory()
  await runCaptionContext(state)

  if (!DRY_RUN) {
    const ok = await verifyAfter(brand.brand_id, before)
    process.exit(ok ? 0 : 1)
  }
}

main().catch((e) => { console.error('[test-agents] crashed:', e); process.exit(2) })
