#!/usr/bin/env node
/**
 * HTTP smoke test — calls the live `/api/agents/*` routes the way n8n will.
 *
 * Prereqs:
 *   1. Run `pnpm --filter web dev` in another terminal (default http://localhost:3000).
 *   2. Have `N8N_WEBHOOK_SECRET` in .env.local (auto-loaded here).
 *   3. To exercise the agents end-to-end, also have the AI keys set; otherwise
 *      the route returns 502 (agent_call_failed) which is still a valid
 *      success criterion for the AUTH layer.
 *
 * What this test verifies:
 *   ✓ HMAC signature is computed + accepted
 *   ✓ Body schema validation rejects malformed input
 *   ✓ Replay protection blocks duplicate request_ids
 *   ✓ Bad signature is rejected with 401
 *   ✓ Missing headers → 401
 *   ✓ Idempotency replay returns the cached response
 *
 * Usage:
 *   pnpm ai:http-smoke                    # default: http://localhost:3000
 *   pnpm ai:http-smoke -- --base=https://staging.openclaw.dev
 *   pnpm ai:http-smoke -- --only=auth    # only run security checks (no AI cost)
 */
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

// ── Env load ─────────────────────────────────────────────────────
loadDotenv(join(root, '.env.local'))

const argv = process.argv.slice(2)
const baseArg = argv.find((a) => a.startsWith('--base='))
const onlyArg = argv.find((a) => a.startsWith('--only='))
const BASE = baseArg ? baseArg.slice('--base='.length) : 'http://localhost:3000'
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null

const SECRET = process.env.N8N_WEBHOOK_SECRET?.trim()
if (!SECRET) {
  console.error('N8N_WEBHOOK_SECRET is not set in .env.local')
  process.exit(1)
}

const SMOKE_BRAND_ID = '11111111-1111-1111-1111-111111111111'
const results = []

console.log(`OpenClaw — HTTP route smoke (${BASE})`)
console.log('═'.repeat(45))

// ── Section 1 — security/auth checks (no AI cost) ────────────────
if (!ONLY || ONLY.has('auth')) {
  await check('rejects request with no signature', async () => {
    const r = await fetch(`${BASE}/api/agents/ceo/classify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    return r.status === 401
  })

  await check('rejects request with bad signature', async () => {
    const r = await postSigned('/api/agents/ceo/classify', {}, { signatureOverride: 'deadbeef' })
    return r.status === 401
  })

  await check('rejects timestamp older than 5 minutes', async () => {
    const r = await postSigned('/api/agents/ceo/classify', {}, {
      timestampOverride: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    })
    return r.status === 401
  })

  await check('rejects body that fails Zod validation', async () => {
    const r = await postSigned('/api/agents/ceo/classify', { not_a_real_field: true })
    return r.status === 400
  })

  // For replay/idempotency we use an endpoint whose only failure mode is
  // input-validation, so we don't depend on external AI providers.
  await check('blocks duplicate request_id (replay)', async () => {
    const requestId = randomUUID()
    // Send a body that intentionally fails validation — first call returns 400,
    // duplicate must return 409 (replay protection runs BEFORE Zod).
    const body = { not_real: true }
    const a = await postSigned('/api/agents/ceo/classify', body, { requestIdOverride: requestId })
    const b = await postSigned('/api/agents/ceo/classify', body, { requestIdOverride: requestId })
    if (a.status !== 400) return `first call status=${a.status}, expected 400`
    return b.status === 409
  })

  await check('idempotency replay returns cached body', async () => {
    // Idempotency is cached only on 2xx — so we need a successful call.
    // Without AI keys we can't get 2xx from /agents/*. But /api/webhooks/n8n
    // returns 200 on a valid payload (just writes to usage_logs), so we use
    // that as the idempotency probe.
    const idempKey = `smoke-${randomUUID()}`
    const body = { event_type: 'smoke', flow_id: 'smoke', payload: { hello: 'world' } }
    const a = await postSigned('/api/webhooks/n8n', body, { idempotencyKeyOverride: idempKey })
    const b = await postSigned('/api/webhooks/n8n', body, { idempotencyKeyOverride: idempKey })
    if (a.status !== 200) return `first call status=${a.status} body=${await a.text()}`
    return b.status === 200 && b.headers.get('x-openclaw-idempotency-replay') === '1'
  })
}

// ── Section 2 — agent calls (cost ~ $0.01) ───────────────────────
if (!ONLY || ONLY.has('agents')) {
  await check('CEO classify returns RoutingDecision', async () => {
    const r = await postSigned('/api/agents/ceo/classify', makeCeoClassifyBody())
    if (r.status !== 200) return `status=${r.status} body=${JSON.stringify(await r.json())}`
    const body = await r.json()
    return body?.ok === true && typeof body?.result?.decision_id === 'string'
  })

  await check('CCO qc returns evaluations array', async () => {
    const r = await postSigned('/api/agents/cco/qc', makeCcoQcBody())
    if (r.status !== 200) return `status=${r.status} body=${JSON.stringify(await r.json())}`
    const body = await r.json()
    return Array.isArray(body?.result) && body.result.length > 0
  })
}

// ── Summary ──────────────────────────────────────────────────────
console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length} / ${results.length} passed`)
if (failed.length > 0) process.exit(1)

// ────────────────────────────────────────────────────────────────
async function check(name, fn) {
  try {
    const r = await fn()
    if (r === true) {
      console.log(`  ✓ ${name}`)
      results.push({ name, ok: true })
    } else {
      const detail = typeof r === 'string' ? `  (${r})` : ''
      console.log(`  ✗ ${name}${detail}`)
      results.push({ name, ok: false, detail })
    }
  } catch (e) {
    console.log(`  ✗ ${name}  (threw: ${e.message})`)
    results.push({ name, ok: false, detail: e.message })
  }
}

async function postSigned(path, body, opts = {}) {
  const requestId = opts.requestIdOverride ?? randomUUID()
  const timestamp = opts.timestampOverride ?? new Date().toISOString()
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
  const signature = opts.signatureOverride ?? createHmac('sha256', SECRET).update(rawBody).digest('hex')
  const headers = {
    'content-type': 'application/json',
    'x-n8n-signature': signature,
    'x-n8n-request-id': requestId,
    'x-n8n-timestamp': timestamp,
  }
  if (opts.idempotencyKeyOverride) headers['x-n8n-idempotency-key'] = opts.idempotencyKeyOverride
  return fetch(`${BASE}${path}`, { method: 'POST', headers, body: rawBody })
}

function makeCeoClassifyBody() {
  return {
    flow_id: 'N8N-A02',
    brand_id: SMOKE_BRAND_ID,
    payload: {
      request_type: 'calendar_ondemand',
      trigger_payload: { source: 'http_smoke' },
      evidence_bundle_states: {
        arabic_dialect: 'inferred_high',
        brand_differentiator: 'explicitly_confirmed',
        price_position: 'explicitly_confirmed',
        primary_channel: 'explicitly_confirmed',
        ramadan_relevance: 'inferred_high',
        'primary_audience.gender': 'inferred_medium',
        primary_kpi_type: 'explicitly_confirmed',
        religious_sensitivity: 'inferred_medium',
        tone_anti_attribute_ids: 'explicitly_confirmed',
        bilingual_ratio: 'explicitly_confirmed',
      },
      occasion_flags: ['none'],
      current_month_spend_usd: 5.0,
      monthly_ceiling_usd: 50.0,
    },
  }
}

function makeCcoQcBody() {
  return {
    flow_id: 'N8N-A02',
    brand_id: SMOKE_BRAND_ID,
    payload: {
      caption_context_excerpt:
        'Brand: Najd Restaurant (مطعم نجد), F&B casual dining in Riyadh. Dialect: Najdi. ' +
        'Tone: warm, family_focused, proud_saudi.',
      posts: [
        {
          post_id: 'http_smoke_001',
          caption_ar: 'بيت نجد يجمعكم الليلة على قهوة سعودية وتمر — تعالوا تذوّقوا الجلسة الأصيلة.',
          content_type: 'lifestyle',
          posting_time: '19:30',
        },
      ],
    },
  }
}

function loadDotenv(path) {
  try {
    const raw = readFileSync(path, 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* file may be missing in CI — that's fine */
  }
}
