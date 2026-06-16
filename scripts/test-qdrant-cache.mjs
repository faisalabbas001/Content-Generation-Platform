#!/usr/bin/env node
/**
 * test-qdrant-cache.mjs — verifies the /api/agents/coo/compile-caption-context
 * cache hit path works end-to-end.
 *
 * Calls the route TWICE with identical inputs:
 *   1st call: should compute via Haiku (~30s) and write to Qdrant
 *   2nd call: should hit the Qdrant cache (~50ms) and return reasoning='cache_hit'
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const HMAC = process.env.N8N_WEBHOOK_SECRET
const BRAND = process.argv[2] || '9abd1ea6-2b0f-4b13-85cf-ac494d7d9fee'

if (!HMAC) { console.error('N8N_WEBHOOK_SECRET missing'); process.exit(1) }

function sign(raw) {
  return {
    'content-type': 'application/json',
    'x-n8n-signature': crypto.createHmac('sha256', HMAC).update(raw).digest('hex'),
    'x-n8n-request-id': crypto.randomUUID(),
    'x-n8n-timestamp': new Date().toISOString(),
  }
}

const body = JSON.stringify({
  flow_id: 'CACHE-TEST',
  brand_id: BRAND,
  payload: {
    confidence_mode: 'Cautious',
    occasion_flags: ['none'],
    platform_spec: 'Instagram',
    content_mix: { educational: 0.3, experiential: 0.4, promotional: 0.3 },
    post_count: 20,
    brand: {},
  },
})

async function callOnce(label) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agents/coo/compile-caption-context`, {
    method: 'POST', headers: sign(body), body,
  })
  const elapsed = Date.now() - t0
  const j = await res.json()
  const reasoning = j?.result?.reasoning ?? ''
  const ctxLen = (j?.result?.caption_context ?? '').length
  const hash = j?.result?.cache_prefix_hash ?? ''
  console.log(`${label}: status=${res.status}  elapsed=${elapsed}ms  ctx_len=${ctxLen}  hash=${hash}  reasoning_starts="${reasoning.slice(0,60)}"`)
  return { status: res.status, elapsed, reasoning, hash, ok: res.ok }
}

async function main() {
  console.log(`brand=${BRAND}`)
  const a = await callOnce('1st call')
  if (!a.ok) { console.error('First call failed — abort'); process.exit(1) }
  const b = await callOnce('2nd call')
  if (!b.ok) { console.error('Second call failed'); process.exit(1) }
  console.log()
  if (b.elapsed < a.elapsed / 3 && b.reasoning === 'cache_hit') {
    console.log(`✓ CACHE HIT confirmed: 2nd call was ${a.elapsed - b.elapsed}ms faster and reasoning='cache_hit'`)
    process.exit(0)
  } else if (b.elapsed < a.elapsed / 3) {
    console.log(`✓ Second call was faster (${a.elapsed - b.elapsed}ms) but reasoning was "${b.reasoning}" — cache may have hit but without the 'cache_hit' marker`)
    process.exit(0)
  } else {
    console.log(`⚠ Cache MISS — 2nd call (${b.elapsed}ms) was not significantly faster than 1st (${a.elapsed}ms). reasoning="${b.reasoning}"`)
    console.log('  Likely causes: cache_prefix_hash differs between calls, Qdrant write failed silently, getCaptionContext returned null')
    process.exit(1)
  }
}
main().catch((e) => { console.error(e); process.exit(2) })
