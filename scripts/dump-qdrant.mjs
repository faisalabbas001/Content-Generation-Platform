#!/usr/bin/env node
/**
 * dump-qdrant.mjs — dump every point in a brand's Qdrant collection.
 * Usage: node scripts/dump-qdrant.mjs <brand_id>
 */
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const QURL = (process.env.QDRANT_URL || '').replace(/\/$/, '')
const QKEY = process.env.QDRANT_API_KEY
const BID = process.argv[2] || 'eb1567f8-98d6-4f28-b963-8c7f07cc2610'

const headers = { 'api-key': QKEY, 'content-type': 'application/json' }
const COLL = `brand_${BID}`

console.log(`Qdrant collection: ${COLL}\n`)

const collRes = await fetch(`${QURL}/collections/${COLL}`, { headers })
const cj = await collRes.json()
console.log(`Collection meta: points=${cj?.result?.points_count}, vector_size=${cj?.result?.config?.params?.vectors?.size}, distance=${cj?.result?.config?.params?.vectors?.distance}\n`)

const scrollRes = await fetch(`${QURL}/collections/${COLL}/points/scroll`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ limit: 100, with_payload: true, with_vector: false }),
})
const sj = await scrollRes.json()
const pts = sj?.result?.points ?? []

console.log(`Total points fetched: ${pts.length}\n`)
console.log('═'.repeat(80))

// Sort by compiled_at / inserted_at if present (newest first)
pts.sort((a, b) => {
  const at = a.payload?.compiled_at ?? a.payload?.inserted_at ?? a.payload?.posted_at ?? ''
  const bt = b.payload?.compiled_at ?? b.payload?.inserted_at ?? b.payload?.posted_at ?? ''
  return String(bt).localeCompare(String(at))
})

for (let i = 0; i < pts.length; i++) {
  const p = pts[i]
  const pl = p.payload ?? {}
  console.log(`\n── Point ${i + 1}/${pts.length} ──`)
  console.log(`  id:    ${p.id}`)
  console.log(`  kind:  ${pl.kind}`)
  console.log(`  _key:  ${pl._key}`)
  if (pl.kind === 'compiled_caption_context') {
    console.log(`  cache_prefix_hash:      ${pl.cache_prefix_hash}`)
    console.log(`  token_count:            ${pl.token_count}`)
    console.log(`  layers_included:        ${JSON.stringify(pl.layers_included)}`)
    console.log(`  watermark_flag:         ${pl.watermark_flag}`)
    console.log(`  cautious_register_flag: ${pl.cautious_register_flag}`)
    console.log(`  compiled_at:            ${pl.compiled_at}`)
    console.log(`  flow_id:                ${pl.flow_id}`)
    console.log(`  caption_context (${(pl.caption_context ?? '').length} chars):`)
    console.log('  ' + '─'.repeat(76))
    console.log((pl.caption_context ?? '').split('\n').map((l) => '    ' + l).join('\n'))
    console.log('  ' + '─'.repeat(76))
  } else if (pl.kind === 'scraped_caption') {
    console.log(`  source:    ${pl.source}`)
    console.log(`  ig_post_id: ${pl.ig_post_id}`)
    console.log(`  post_type: ${pl.post_type}  likes=${pl.likes} comments=${pl.comments}  posted_at=${pl.posted_at}`)
    console.log(`  hashtags:  ${JSON.stringify(pl.hashtags)}`)
    console.log(`  mentions:  ${JSON.stringify(pl.mentions)}`)
    console.log(`  caption: ${(pl.caption ?? '').slice(0, 400)}${(pl.caption ?? '').length > 400 ? '…' : ''}`)
  } else {
    console.log(`  ${JSON.stringify(pl, null, 2).split('\n').map((l) => '    ' + l).join('\n')}`)
  }
}
