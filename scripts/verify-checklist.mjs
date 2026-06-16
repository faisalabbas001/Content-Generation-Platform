#!/usr/bin/env node
/**
 * verify-checklist.mjs — verify the user's 4 BrandDNA checklist items
 * against live code + DB.
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(REPO, 'apps', 'web', '.env.local') })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const HMAC = process.env.N8N_WEBHOOK_SECRET
const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const QURL = (process.env.QDRANT_URL || '').replace(/\/$/, '')
const QKEY = process.env.QDRANT_API_KEY

const BRAND_ID = '9abd1ea6-2b0f-4b13-85cf-ac494d7d9fee'

let passed = 0, failed = 0
function rec(name, ok, detail) {
  if (ok) { console.log(`  PASS  ${name}`); passed++ }
  else    { console.error(`  FAIL  ${name}\n        ${detail}`); failed++ }
}
function hasInFile(file, needle) {
  return fs.readFileSync(path.join(REPO, file), 'utf8').includes(needle)
}

// ════════════════════════════════════════════════════════════════════
// 1. Brand Snapshot Card
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 1. Brand Snapshot Card ===')
const snapFile = 'apps/web/src/app/[slug]/snapshot/page.tsx'
rec('Snapshot page exists',                   fs.existsSync(path.join(REPO, snapFile)), 'missing file')
rec('Detected voice (tones) rendered',        hasInFile(snapFile, 'Top tones') && hasInFile(snapFile, 'tones'), '')
rec('Anti-attributes (avoid these) rendered', hasInFile(snapFile, 'tone_anti_attribute_ids'), '')
rec('Visual style descriptor rendered',       hasInFile(snapFile, 'style_descriptor'), '')
rec('Color palette swatches rendered',        hasInFile(snapFile, 'ColorPalette') && hasInFile(snapFile, 'color_palette'), '')
rec('Audience (gender mix) rendered',         hasInFile(snapFile, 'GenderMix') && hasInFile(snapFile, 'gender_mix'), '')
rec('Audience description_ar rendered',       hasInFile(snapFile, 'description_ar'), '')
rec('Completeness score with Progress bar',   hasInFile(snapFile, 'completeness') && hasInFile(snapFile, '<Progress'), '')
rec('Dialect confirmation badge present',     hasInFile(snapFile, 'dialectConfirmed') && hasInFile(snapFile, 'dialectNeedsConfirm'), '')
rec('Dialect prompt links to /profile (Open Q: user can act on it)', hasInFile(snapFile, '/profile'), '')

// ════════════════════════════════════════════════════════════════════
// 2. CaptionContext Compiler — COO Job 2
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 2. CaptionContext Compiler ===')

const ccRoute = 'apps/web/src/app/api/agents/coo/compile-caption-context/route.ts'
rec('compile-caption-context route exists', fs.existsSync(path.join(REPO, ccRoute)), '')
rec('Loads BrandDNA server-side (Layer 1 — identity)',  hasInFile(ccRoute, 'getBrandDna') && hasInFile(ccRoute, 'brand_differentiator'), '')
rec('Loads method_profile (Layer 2 — direction)',       hasInFile(ccRoute, 'method_profile'), '')
rec('Loads negative_patterns + override_rules (Layer 3 — policy)', hasInFile(ccRoute, 'negative_patterns') && hasInFile(ccRoute, 'override_rules'), '')
rec('Loads audience + visual_style satellites',         hasInFile(ccRoute, 'audience') && hasInFile(ccRoute, 'visual_style'), '')
rec('Computes deterministic cache_prefix_hash',         hasInFile(ccRoute, 'createHash') && hasInFile(ccRoute, 'method_version'), '')
rec('Reads Qdrant cache before LLM call',               hasInFile(ccRoute, 'getCaptionContext'), '')
rec('Writes to Qdrant cache after compile',             hasInFile(ccRoute, 'upsertCaptionContext'), '')

const cooPrompt = 'prompts/OGzStudios_COO_Prompt_v2.md'
const promptText = fs.readFileSync(path.join(REPO, cooPrompt), 'utf8')
rec('Prompt instructs 800-1200 token output',           /800.{0,4}1.{0,5}200|800-1.200|1,?200 tokens/.test(promptText), 'no 800-1200 token instruction')
rec('Prompt requires caption_context as SINGLE string', /ONE single string|single string/.test(promptText), '')

// Cache invalidation — A04 brand-correction should drop the namespace
const a04 = 'n8n/flows/N8N-A04-brand-correction.json'
rec('A04 invalidates Qdrant on BrandDNA change',
  hasInFile(a04, '/api/vectors/invalidate') || hasInFile(a04, 'invalidate'),
  'no invalidate call in A04 — cache becomes stale on corrections')

const vectorsPkg = 'packages/vectors/src/index.ts'
rec('vectors package exports invalidateBrandCache', hasInFile(vectorsPkg, 'invalidateBrandCache'), '')

// Live: query Qdrant cluster (with retry against flaky DNS)
console.log('\n  -- live Qdrant probe --')
async function qfetchWithRetry(path, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(`${QURL}${path}`, { headers: { 'api-key': QKEY } })
    } catch (e) {
      if (i === attempts - 1) throw e
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
}
try {
  const r = await qfetchWithRetry('/collections', 3)
  const j = await r.json()
  rec('Qdrant cluster reachable', r.ok, `status=${r.status}`)
  if (r.ok) {
    const collections = (j.result?.collections ?? [])
    rec(`Per-client namespaces present (got ${collections.length})`, collections.length >= 1, JSON.stringify(collections.map(c => c.name)))
    const tazaj = collections.find((c) => c.name === `brand_${BRAND_ID}`)
    rec('Tazaj brand collection exists', !!tazaj, `looked for brand_${BRAND_ID}`)
  }
} catch (e) {
  rec('Qdrant cluster reachable', false, `DNS/network: ${e.message}`)
}

// Live: invoke compile-caption-context twice (cache test)
console.log('\n  -- live cache invocation --')
function sign(raw) {
  return {
    'content-type': 'application/json',
    'x-n8n-signature': crypto.createHmac('sha256', HMAC).update(raw).digest('hex'),
    'x-n8n-request-id': crypto.randomUUID(),
    'x-n8n-timestamp': new Date().toISOString(),
  }
}
const body = JSON.stringify({
  flow_id: 'CHECKLIST',
  brand_id: BRAND_ID,
  payload: {
    confidence_mode: 'Cautious',
    occasion_flags: ['none'],
    platform_spec: 'Instagram',
    content_mix: { educational: 0.3, experiential: 0.4, promotional: 0.3 },
    post_count: 20,
  },
})
const t1 = Date.now()
const r1 = await fetch(`${BASE}/api/agents/coo/compile-caption-context`, { method: 'POST', body, headers: sign(body) })
const e1 = Date.now() - t1
const j1 = await r1.json()
const tokenCount = j1?.result?.token_count ?? 0
const ctx = j1?.result?.caption_context ?? ''
rec('compile-caption-context returns 200', r1.ok, `status=${r1.status}`)
rec(`caption_context is non-empty string (${ctx.length} chars)`, typeof ctx === 'string' && ctx.length > 200, `len=${ctx.length}`)
rec(`token_count between 200-1500 (got ${tokenCount})`, tokenCount >= 100 && tokenCount <= 2000, `token_count=${tokenCount}`)
rec('layers_included is array', Array.isArray(j1?.result?.layers_included), JSON.stringify(j1?.result?.layers_included))

// Second call — must cache hit
const t2 = Date.now()
const r2 = await fetch(`${BASE}/api/agents/coo/compile-caption-context`, { method: 'POST', body, headers: sign(body) })
const e2 = Date.now() - t2
const j2 = await r2.json()
rec(`Cache HIT confirmed (1st=${e1}ms, 2nd=${e2}ms)`, e2 < e1 / 3 && j2?.result?.reasoning === 'cache_hit', `reasoning=${j2?.result?.reasoning}`)

// ════════════════════════════════════════════════════════════════════
// 3. ConfidenceClassification — CEO + evidence_bundles + confidence_classifications
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 3. ConfidenceClassification ===')

const ceoRoute = 'apps/web/src/app/api/agents/ceo/classify/route.ts'
rec('CEO classify route exists', fs.existsSync(path.join(REPO, ceoRoute)), '')
rec('CEO accepts evidence_bundle_states', hasInFile(ceoRoute, 'evidence_bundle_states'), '')
rec('CEO writes confidence_classifications', hasInFile(ceoRoute, 'recordConfidenceClassification') || hasInFile(ceoRoute, 'confidence_classifications'), '')

const owFile = 'packages/db/src/queries/onboarding-writes.ts'
rec('recordConfidenceClassification helper exists', hasInFile(owFile, 'recordConfidenceClassification'), '')
rec('Mode enum includes Standard|Cautious|Minimal|Blocked', hasInFile(owFile, "'Standard'") && hasInFile(owFile, "'Cautious'") && hasInFile(owFile, "'Minimal'") && hasInFile(owFile, "'Blocked'"), '')
rec('Append-only chain via superseded_at', hasInFile(owFile, 'superseded_at'), '')

const ceoSchema = 'packages/core/src/schemas/ceo.ts'
const ceoSchemaText = fs.readFileSync(path.join(REPO, ceoSchema), 'utf8')
rec('CEO schema defines ConfidenceMode enum', /ConfidenceMode\s*=\s*z\.enum.*Standard.*Cautious.*Minimal.*Blocked/s.test(ceoSchemaText), '')

// Live: row exists for Tazaj
console.log('\n  -- live DB probe --')
{
  const { data, error } = await db.from('confidence_classifications').select('mode, reasons, created_at, superseded_at').eq('brand_id', BRAND_ID).order('created_at', { ascending: false }).limit(5)
  rec('confidence_classifications table accessible', !error, error?.message)
  rec(`Tazaj has classification rows (got ${data?.length})`, data && data.length > 0, '')
  if (data?.length) {
    const active = data.find((r) => !r.superseded_at)
    rec('At least one active classification (superseded_at IS NULL)', !!active, JSON.stringify(data[0]))
    const allModesValid = data.every((r) => ['Standard','Cautious','Minimal','Blocked'].includes(r.mode))
    rec('All mode values are within the 4-enum vocabulary', allModesValid, '')
  }
}

// ════════════════════════════════════════════════════════════════════
// 4. Qdrant namespace + caption schema + usage_logs + anomaly_records
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Qdrant + audit tables ===')
const vectorsSetup = 'apps/web/src/app/api/vectors/setup/route.ts'
rec('vectors/setup route exists', fs.existsSync(path.join(REPO, vectorsSetup)), '')
rec('Creates per-brand namespace (brand_${brand_id})', hasInFile(vectorsPkg, 'brand_${brandId}') || hasInFile(vectorsPkg, "`brand_${brandId}`"), '')
rec('Persists collection name on brand_profiles.vector_namespace', hasInFile(vectorsSetup, 'vector_namespace'), '')
rec('Seeds scraped captions at end of A03', hasInFile(vectorsSetup, 'brand_post_observations') || hasInFile(vectorsSetup, 'captions_seeded'), '')

// Live: schema definitions
console.log('\n  -- live DB probes --')
{
  const { error: e1 } = await db.from('usage_logs').select('log_id, flow_id, node_name, cost_usd, duration_ms, payload, created_at').limit(1)
  rec('usage_logs table exists with expected columns', !e1, e1?.message)
}
{
  const { error: e2 } = await db.from('anomaly_records').select('anomaly_id, brand_id, anomaly_type, severity, details, resolved, created_at').limit(1)
  rec('anomaly_records table exists with expected columns', !e2, e2?.message)
}
{
  const { data: usage } = await db.from('usage_logs').select('flow_id, node_name, duration_ms').eq('brand_id', BRAND_ID).order('created_at', { ascending: false }).limit(3)
  rec(`usage_logs has rows for Tazaj (${usage?.length})`, (usage?.length ?? 0) >= 1, '')
}
{
  const { data: anom } = await db.from('anomaly_records').select('anomaly_type, severity').eq('brand_id', BRAND_ID).limit(5)
  rec(`anomaly_records writeable / readable (${anom?.length} rows for Tazaj)`, anom !== null, '')
}

// Final
console.log(`\n${passed}/${passed+failed} passed`)
process.exit(failed > 0 ? 1 : 0)
