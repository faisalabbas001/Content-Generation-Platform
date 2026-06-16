#!/usr/bin/env node
/**
 * trigger-d02.mjs — manual D02 maintenance trigger.
 *
 * D02 is cron-scheduled (1st of month, 04:00 AST). For testing it on demand,
 * this script does what the D02 nodes do, in Node directly:
 *
 *   1. SELECT evidence_bundles where last_evaluated < (now - 90 days)
 *   2. For each, decide the decay step (high→medium→low→deprecated)
 *   3. Enqueue confidence_upgrade nominations via the Memory Controller queue
 *   4. POST /api/memory/process to drain
 *
 * Usage:
 *   node scripts/trigger-d02.mjs                  # real run
 *   node scripts/trigger-d02.mjs --dry-run        # show what would change
 *   node scripts/trigger-d02.mjs --threshold=30   # custom stale-threshold (days)
 */

import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const DRY = !!args['dry-run']
const STALE_DAYS = parseInt(args.threshold ?? '90', 10)
const DEPRECATED_DAYS = parseInt(args['deprecated-threshold'] ?? '365', 10)
const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const HMAC_SECRET  = process.env.N8N_WEBHOOK_SECRET
if (!SUPABASE_URL || !SUPABASE_KEY || !HMAC_SECRET) {
  console.error('[d02] FAIL — missing env vars')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

const DECAY = {
  inferred_high:    'inferred_medium',
  inferred_medium:  'inferred_low',
  inferred_low:     'inferred_low',
  evidence_strong:  'evidence_weak',
  evidence_weak:    'inferred_low',
}

function decideNext(currentState, ageDays) {
  if (ageDays > DEPRECATED_DAYS) return 'deprecated'
  return DECAY[currentState] ?? currentState
}

async function main() {
  console.log(`[d02] BASE=${BASE} stale=${STALE_DAYS}d deprecated=${DEPRECATED_DAYS}d dry=${DRY}`)

  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString()
  const { data: stale, error } = await db.from('evidence_bundles')
    .select('bundle_id, brand_id, field_name, field_confidence, last_evaluated, supporting_source_ids, agreement_ratio')
    .lt('last_evaluated', cutoff)
  if (error) {
    console.error(`[d02] SELECT failed: ${error.message}`)
    process.exit(1)
  }
  console.log(`[d02] ${stale?.length ?? 0} stale evidence rows`)

  const now = Date.now()
  const nominations = []
  for (const b of stale ?? []) {
    const ageDays = Math.floor((now - new Date(b.last_evaluated).getTime()) / 86400000)
    const next = decideNext(b.field_confidence, ageDays)
    if (next === b.field_confidence) continue  // no-op
    nominations.push({
      brand_id: b.brand_id,
      bundle_id: b.bundle_id,
      field_name: b.field_name,
      ageDays,
      current: b.field_confidence,
      next,
      sources: b.supporting_source_ids ?? [],
    })
  }
  console.log(`[d02] ${nominations.length} nominations to enqueue`)

  if (DRY) {
    for (const n of nominations.slice(0, 20)) {
      console.log(`  ${n.brand_id.slice(0,8)} ${n.field_name}: ${n.current} → ${n.next} (age=${n.ageDays}d)`)
    }
    if (nominations.length > 20) console.log(`  … and ${nominations.length - 20} more`)
    process.exit(0)
  }

  if (nominations.length === 0) {
    console.log('[d02] nothing to do — exit')
    process.exit(0)
  }

  // Bulk insert (skip the agent route — D02 uses the Memory Controller directly,
  // mirroring n8n's Supabase node).
  const rows = nominations.map((n) => ({
    brand_id: n.brand_id,
    nomination_type: 'confidence_upgrade',
    nomination_data: {
      field_name: n.field_name,
      new_state: n.next,
      evidence_source_ids: n.sources.length > 0 ? n.sources : [],
      agreement_ratio: 1.0,
      reasoning: `maintenance_age_decay age=${n.ageDays}d`,
    },
    nominated_by: 'D02_manual',
    status: 'pending',
  }))
  const { error: insErr } = await db.from('memory_controller_queue').insert(rows)
  if (insErr) {
    console.error(`[d02] enqueue failed: ${insErr.message}`)
    process.exit(1)
  }
  console.log(`[d02] enqueued ${rows.length} confidence_upgrade nominations`)

  // Drain via the HTTP route so the same code path runs as in prod.
  const drainBody = JSON.stringify({ flow_id: 'D02_manual', batch_size: 500 })
  const ts = new Date().toISOString()
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(drainBody).digest('hex')
  const res = await fetch(`${BASE}/api/memory/process`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-n8n-signature': sig,
      'x-n8n-request-id': crypto.randomUUID(),
      'x-n8n-timestamp': ts,
    },
    body: drainBody,
  })
  const drainResp = await res.json().catch(() => ({}))
  console.log(`[d02] drain → ${res.status} ${JSON.stringify(drainResp).slice(0, 300)}`)
  process.exit(res.ok ? 0 : 1)
}

main().catch((e) => { console.error('[d02] crashed:', e); process.exit(2) })
