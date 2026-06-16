#!/usr/bin/env node
/**
 * test-qdrant.mjs — end-to-end Qdrant verification.
 *
 * 1. Confirms QDRANT_URL + QDRANT_API_KEY are set
 * 2. Probes /collections root — verifies the cluster is reachable
 * 3. Creates (or confirms) the brand collection
 * 4. Upserts a dummy CaptionContext payload point
 * 5. Reads it back by key
 * 6. Searches/scrolls the collection to list all points
 * 7. (Optional) cleans up the dummy point
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const QDRANT_URL = (process.env.QDRANT_URL || '').replace(/\/$/, '')
const QDRANT_KEY = process.env.QDRANT_API_KEY || ''
if (!QDRANT_URL || !QDRANT_KEY) {
  console.error('FATAL: QDRANT_URL or QDRANT_API_KEY missing')
  process.exit(1)
}

const BRAND_ID = process.argv[2] || '9abd1ea6-2b0f-4b13-85cf-ac494d7d9fee'
const COLLECTION = `brand_${BRAND_ID}`
const TEST_KEY = `test_smoke_${Date.now()}`
const CLEANUP = process.argv.includes('--cleanup')

const headers = { 'api-key': QDRANT_KEY, 'content-type': 'application/json' }

function deterministicPointId(key) {
  const h = crypto.createHash('sha256').update(key).digest('hex')
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-')
}

let pass = 0, fail = 0
function rec(name, ok, detail) {
  if (ok) { console.log(`  PASS  ${name}`); pass++ }
  else    { console.error(`  FAIL  ${name}\n        ${detail}`); fail++ }
}

async function main() {
  console.log(`Qdrant URL: ${QDRANT_URL}`)
  console.log(`Collection: ${COLLECTION}`)
  console.log(`Test key:   ${TEST_KEY}`)
  console.log()

  // 1. Reachability — list collections
  console.log('── 1. Cluster reachability ──')
  try {
    const r = await fetch(`${QDRANT_URL}/collections`, { headers })
    const body = await r.json()
    rec('GET /collections returns 200', r.ok, `status=${r.status}`)
    const colls = body?.result?.collections ?? []
    console.log(`        ${colls.length} collections in cluster`)
    if (colls.length > 0) console.log(`        Sample: ${colls.slice(0, 5).map((c) => c.name).join(', ')}`)
  } catch (e) {
    rec('Cluster unreachable', false, e.message)
    process.exit(1)
  }

  // 2. Create / confirm brand collection
  console.log('\n── 2. Brand collection ──')
  let createdNow = false
  let r1 = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { headers })
  if (r1.status === 404) {
    const r = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ vectors: { size: 1, distance: 'Cosine' } }),
    })
    rec('Created brand collection', r.ok, `status=${r.status} body=${await r.text().then((t) => t.slice(0, 200))}`)
    createdNow = true
    r1 = await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, { headers })
  }
  rec('Brand collection exists', r1.ok, `status=${r1.status}`)
  if (r1.ok) {
    const j = await r1.json()
    console.log(`        Vector size: ${j?.result?.config?.params?.vectors?.size ?? '?'}, distance: ${j?.result?.config?.params?.vectors?.distance ?? '?'}, points: ${j?.result?.points_count ?? 0}`)
  }

  // 3. Upsert a dummy CaptionContext point
  console.log('\n── 3. Upsert dummy caption_context ──')
  const dummyPayload = {
    _key: TEST_KEY,
    kind: 'test_caption_context',
    caption_context: 'BRAND IDENTITY: dummy test brand for smoke testing.\n\nCREATIVE DIRECTION:\nVoice: authoritative_warm.\nVisual: minimal_natural_light.\n\nCONSTRAINTS:\nNo Arabic in image prompts.\nNo salesy language.\n\nPOLICY:\nRespect religious sensitivities.\nNo political content.',
    token_count: 50,
    layers_included: ['identity', 'constraints', 'policy'],
    watermark_flag: false,
    cautious_register_flag: true,
    inserted_at: new Date().toISOString(),
  }
  const pointId = deterministicPointId(TEST_KEY)
  const upsertRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ points: [{ id: pointId, vector: [0], payload: dummyPayload }] }),
  })
  rec('Upsert dummy point', upsertRes.ok, `status=${upsertRes.status} body=${await upsertRes.text().then((t) => t.slice(0, 200))}`)
  console.log(`        Point ID: ${pointId}`)

  // 4. Read it back by ID
  console.log('\n── 4. Read by ID ──')
  const getRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/${pointId}`, { headers })
  rec('GET point by ID returns 200', getRes.ok, `status=${getRes.status}`)
  if (getRes.ok) {
    const gotBody = await getRes.json()
    const gotPayload = gotBody?.result?.payload
    rec('Payload _key matches', gotPayload?._key === TEST_KEY, `got _key=${gotPayload?._key}`)
    rec('Payload caption_context preserved', typeof gotPayload?.caption_context === 'string' && gotPayload.caption_context.includes('BRAND IDENTITY'), `caption_context=${(gotPayload?.caption_context ?? '').slice(0, 60)}`)
    rec('Payload layers_included is array', Array.isArray(gotPayload?.layers_included) && gotPayload.layers_included.length === 3, `layers=${JSON.stringify(gotPayload?.layers_included)}`)
  }

  // 5. Scroll all points (list)
  console.log('\n── 5. Scroll points (cap 10) ──')
  const scrollRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ limit: 10, with_payload: true, with_vector: false }),
  })
  if (scrollRes.ok) {
    const scrolled = await scrollRes.json()
    const points = scrolled?.result?.points ?? []
    rec(`Scroll returned ${points.length} points`, points.length > 0, JSON.stringify(scrolled).slice(0, 200))
    for (const p of points.slice(0, 5)) {
      console.log(`        ${p.id.slice(0, 12)}…  kind=${p.payload?.kind ?? '?'}  _key=${(p.payload?._key ?? '').slice(0, 40)}`)
    }
  } else {
    rec('Scroll failed', false, `status=${scrollRes.status}`)
  }

  // 6. Cleanup (optional)
  if (CLEANUP) {
    console.log('\n── 6. Cleanup dummy point ──')
    const delRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/delete?wait=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ points: [pointId] }),
    })
    rec('Delete dummy point', delRes.ok, `status=${delRes.status}`)
  } else {
    console.log(`\n  (Re-run with --cleanup to delete the dummy point ${pointId.slice(0, 12)}…)`)
  }

  console.log(`\n${pass}/${pass + fail} passed${createdNow ? ' (collection was just created)' : ''}`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('CRASHED:', e); process.exit(2) })
