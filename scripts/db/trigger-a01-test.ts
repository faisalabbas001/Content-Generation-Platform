/**
 * Trigger N8N-A01 (batch calendar generation) for the 3 seeded Saudi test brands.
 *
 * Posts an HMAC-signed webhook to openclaw-batch-calendar with { brand_id }
 * which bypasses the shard filter and forces the workflow to process that brand
 * regardless of day-of-week. The workflow will generate a June 2026 calendar
 * (today = 2026-05-25; daysUntilEom=6 → rolls to next month).
 *
 * Usage:
 *   pnpm tsx scripts/db/trigger-a01-test.ts                  # all 3 test brands
 *   pnpm tsx scripts/db/trigger-a01-test.ts <brand_id>       # one specific brand
 *
 * After triggering, the script polls calendars + calendar_posts for each brand
 * for up to 8 minutes.
 *
 * Pre-requisite: run seed first
 *   pnpm tsx scripts/db/seed-sa-test-brands.ts
 *
 * After workflow completes:
 *   1. Go to /admin/content-release — set status to 'pending' (Release button)
 *   2. Client logins below can then see the calendar at /{slug}/calendar
 */

import pg from 'pg'
import { createHmac, randomUUID } from 'node:crypto'
import { loadEnv, getPgConnectionString, requireEnv } from './lib/env.js'

const N8N_BASE_URL     = 'https://ogzstudios.app.n8n.cloud'
// Use /webhook/ (production path) — requires workflow to be ACTIVE in n8n.
// /webhook-test/ only accepts 1 call per "Execute" click — won't work for 3 brands.
const WEBHOOK_PATH     = '/webhook-test/openclaw-batch-calendar'
const TARGET_MONTH_KEY = '2026-06'

const TEST_EMAILS = [
  'test.albaik@openclaw.dev',
  'test.jarir@openclaw.dev',
  'test.nahdi@openclaw.dev',
]

// ── helpers ────────────────────────────────────────────────────────────────

function hmacSign(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('hex')
}

async function postTrigger(
  secret: string,
  brandId: string,
  brandName: string,
): Promise<{ ok: boolean; requestId: string; status?: number; detail?: string }> {
  const requestId = randomUUID()
  const timestamp  = new Date().toISOString()
  const bodyObj    = { brand_id: brandId }
  const rawBody    = JSON.stringify(bodyObj)
  const signature  = hmacSign(secret, rawBody)

  const url = `${N8N_BASE_URL}${WEBHOOK_PATH}`

  console.log(`\n── Triggering N8N-A01 for ${brandName} ──────────────`)
  console.log(`  brand_id    : ${brandId}`)
  console.log(`  request_id  : ${requestId}`)
  console.log(`  webhook     : ${url}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type':      'application/json',
      'x-n8n-signature':   signature,
      'x-n8n-request-id':  requestId,
      'x-n8n-timestamp':   timestamp,
      'x-n8n-idempotency-key': brandId,
    },
    body: rawBody,
    signal: AbortSignal.timeout(15_000),
  })

  const detail = await res.text().catch(() => '')
  if (res.ok) {
    console.log(`  → n8n accepted (${res.status}) — workflow is running`)
  } else {
    console.error(`  ✗ n8n rejected (${res.status}): ${detail.slice(0, 300)}`)
  }
  return { ok: res.ok, requestId, status: res.status, detail }
}

// ── poll helpers ───────────────────────────────────────────────────────────

interface CalendarRow {
  calendar_id: string
  status:      string
  created_at:  Date | null
  delivered_at: Date | null
}
interface PostRow {
  post_id:     string
  status:      string
  caption_ar:  string | null
  posting_time: string | null
  route_decision: string | null
}

async function pollBrand(
  c: pg.Client,
  brandId: string,
  brandName: string,
  deadlineMs: number,
) {
  console.log(`\n  Watching ${brandName} — target month ${TARGET_MONTH_KEY}`)
  console.log('  (poll every 10s; timeout 8 min)')

  let lastCalStatus = ''
  let lastPostCount  = -1

  while (Date.now() < deadlineMs) {
    // calendar row
    const calResult = await c.query<CalendarRow>(
      `select calendar_id, status, created_at, delivered_at
         from public.calendars
        where brand_id = $1 and month = $2
        limit 1`,
      [brandId, TARGET_MONTH_KEY],
    )

    if (calResult.rowCount === 0) {
      process.stdout.write('.')
      await new Promise((r) => setTimeout(r, 10_000))
      continue
    }

    const cal = calResult.rows[0]

    // post count
    const postResult = await c.query<{ count: string }>(
      `select count(*) from public.calendar_posts where calendar_id = $1`,
      [cal.calendar_id],
    )
    const postCount = parseInt(postResult.rows[0].count, 10)

    const tag = `[${new Date().toISOString().slice(11, 19)}]`
    if (cal.status !== lastCalStatus || postCount !== lastPostCount) {
      console.log(
        `\n  ${tag}  calendar.status=${cal.status}  posts=${postCount}`,
      )
      lastCalStatus  = cal.status
      lastPostCount  = postCount
    }

    // Terminal: posts are present — workflow finished inserting
    // calendars.status stays 'draft'; calendar_posts.status='generated' for CLEAN posts
    if (postCount > 0) {
      const generatedCount = await c.query<{ count: string }>(
        `select count(*) from public.calendar_posts where calendar_id = $1 and status = 'generated'`,
        [cal.calendar_id],
      )
      const genCount = parseInt(generatedCount.rows[0].count, 10)

      const sample = await c.query<PostRow>(
        `select post_id, status, caption_ar, posting_time, route_decision
           from public.calendar_posts
          where calendar_id = $1
          order by posting_time
          limit 3`,
        [cal.calendar_id],
      )
      console.log(`\n  ✓ DONE — ${brandName}  calendar_id=${cal.calendar_id}`)
      console.log(`    posts total     : ${postCount}`)
      console.log(`    posts generated : ${genCount}  (ready for admin release)`)
      console.log(`    posts draft     : ${postCount - genCount}  (held / watermarked)`)
      if (sample.rowCount && sample.rowCount > 0) {
        console.log('    sample posts:')
        for (const p of sample.rows) {
          console.log(`      [${p.posting_time?.slice(0, 10)}] ${p.route_decision ?? p.status} — ${(p.caption_ar ?? '').slice(0, 80)}`)
        }
      }
      if (genCount > 0) {
        console.log(`\n  ⚠ Next step: go to /admin/content-release and click Release to move status → 'pending'`)
      }
      return true
    }

    await new Promise((r) => setTimeout(r, 10_000))
  }

  console.log(`\n  ✗ TIMEOUT — ${brandName} still not generated after 8 min. Check n8n.cloud Executions.`)
  return false
}

// ── DB connect with retry ─────────────────────────────────────────────────

async function connectDb(retries = 3, delayMs = 2000): Promise<pg.Client> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const c = new pg.Client({
      connectionString: getPgConnectionString(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    })
    try {
      await c.connect()
      return c
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`  DB connect attempt ${attempt}/${retries} failed: ${msg}`)
      await c.end().catch(() => {})
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw new Error('DB unreachable after retries. Check SUPABASE_URL / SUPABASE_DB_PASSWORD in .env.local')
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv()
  const secret = requireEnv('N8N_WEBHOOK_SECRET').trim()

  type Brand = { brand_id: string; brand_name_ar: string; brand_name_en: string; client_slug: string }

  // ── Phase 1: resolve brand IDs (short-lived connection) ──────────────────
  const argBrandId = process.argv[2]
  let brands: Brand[] = []

  {
    const c = await connectDb()
    try {
      if (argBrandId) {
        const r = await c.query(
          `select brand_id, brand_name_ar, brand_name_en, client_slug
             from public.brand_profiles where brand_id = $1 limit 1`,
          [argBrandId],
        )
        if (r.rowCount === 0) throw new Error(`brand_id ${argBrandId} not found`)
        brands = r.rows as Brand[]
      } else {
        const r = await c.query(
          `select bp.brand_id, bp.brand_name_ar, bp.brand_name_en, bp.client_slug
             from public.brand_profiles bp
             join auth.users au on au.id = bp.auth_user_id
            where au.email = ANY($1::text[])
            order by bp.brand_name_en`,
          [TEST_EMAILS],
        )
        if (r.rowCount === 0) {
          throw new Error(
            'No test brands found. Run seed first:\n  pnpm tsx scripts/db/seed-sa-test-brands.ts',
          )
        }
        brands = r.rows as Brand[]
        console.log(`Found ${r.rowCount} test brand(s) in DB.`)
      }
    } finally {
      await c.end().catch(() => {})
    }
  }

  // ── Phase 2: fire webhooks (no DB needed) ────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════')
  console.log('N8N-A01 Test Trigger — Saudi Test Brands')
  console.log(`Target month : ${TARGET_MONTH_KEY}`)
  console.log(`Brands       : ${brands.map((b) => b.brand_name_ar).join(' · ')}`)
  console.log('══════════════════════════════════════════════════════')

  const triggered: Brand[] = []
  for (const b of brands) {
    const { ok } = await postTrigger(secret, b.brand_id, b.brand_name_ar)
    if (ok) triggered.push(b)
    // Small gap so n8n doesn't dedupe consecutive requests from the same source
    if (brands.indexOf(b) < brands.length - 1) {
      await new Promise((r) => setTimeout(r, 3000))
    }
  }

  if (triggered.length === 0) {
    console.error('\n✗ No triggers accepted by n8n. Check webhook URL and that the workflow is Active.')
    process.exit(1)
  }

  console.log(`\n──────────────────────────────────────────────────────`)
  console.log(`${triggered.length}/${brands.length} triggers accepted — now polling for results…`)
  console.log(`(workflow typically finishes in 3-7 min per brand)`)
  console.log(`──────────────────────────────────────────────────────`)

  // ── Phase 3: poll results (fresh connection) ─────────────────────────────
  const poll = await connectDb()
  try {
    for (const b of triggered) {
      const deadline = Date.now() + 8 * 60 * 1000
      await pollBrand(poll, b.brand_id, b.brand_name_ar, deadline)
    }
  } finally {
    await poll.end().catch(() => {})
  }

  // ── Final instructions ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════')
  console.log('NEXT STEPS')
  console.log('══════════════════════════════════════════════════════')
  console.log('\n1. Admin — approve posts at: /admin/content-release')
  console.log('   Click "Release" on each post → status becomes \'pending\'')
  console.log('\n2. Client logins (calendar visible after admin release):')
  for (const b of brands) {
    console.log(`   ${b.brand_name_ar.padEnd(18)} →  test.${b.brand_name_en.toLowerCase().split(' ')[0]}@openclaw.dev  /  Test@1234!`)
    console.log(`   ${' '.repeat(18)}    /${b.client_slug}/calendar`)
  }
  console.log('\n3. Client approves posts on calendar → status becomes \'approved\'')
  console.log('   N8N-P01 then publishes to Instagram.')
  console.log('\nNote: if calendar posts are still \'generated\' after admin release,')
  console.log('      check /admin/content-release for held (watermarked) posts.')
}

main().catch((e) => { console.error('✗ trigger failed:', e.message); process.exit(1) })
