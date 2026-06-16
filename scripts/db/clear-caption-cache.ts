/**
 * Clears Qdrant CaptionContext caches for all brands.
 * Run before test-caption-context.ts to force fresh LLM calls.
 *
 * Usage:
 *   pnpm tsx scripts/db/clear-caption-cache.ts
 */
import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'

async function main(): Promise<void> {
  loadEnv()

  const qdrantUrl = process.env.QDRANT_URL?.replace(/\/$/, '')
  const qdrantKey = process.env.QDRANT_API_KEY
  if (!qdrantUrl || !qdrantKey) {
    console.log('QDRANT_URL or QDRANT_API_KEY not set — skipping cache clear')
    return
  }

  const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await c.connect()
  const brandsRes = await c.query<{ brand_id: string; client_slug: string }>(
    `select brand_id, client_slug from public.brand_profiles order by completeness_score desc, created_at desc limit 5`,
  )
  await c.end()

  console.log(`\nClearing Qdrant caches for ${brandsRes.rowCount} brands...\n`)

  for (const b of brandsRes.rows) {
    const collection = `brand_${b.brand_id}`
    const res = await fetch(`${qdrantUrl}/collections/${collection}`, {
      method: 'DELETE',
      headers: { 'api-key': qdrantKey, 'content-type': 'application/json' },
    })
    if (res.ok || res.status === 404) {
      console.log(`  ✓ ${b.client_slug.padEnd(30)} — cleared (${res.status})`)
    } else {
      console.log(`  ✗ ${b.client_slug.padEnd(30)} — error ${res.status}: ${await res.text()}`)
    }
  }

  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
