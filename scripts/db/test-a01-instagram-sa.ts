/**
 * End-to-End A01 Calendar Generation Test
 * Saudi Instagram Brand — Monday Shard (batch_shard=1)
 *
 * Does everything in one run:
 *   1. Creates auth user  test.najdcoffee@openclaw.dev  (reuses if exists)
 *   2. Wipes + re-creates a full paid_pro brand profile with all related tables
 *   3. Fires N8N-A01 via webhook with { brand_id } (single-brand bypass)
 *   4. Polls calendars + calendar_posts every 10 s for up to 10 min
 *   5. Prints sample posts + exact URLs for admin approval and client calendar
 *
 * Usage:
 *   pnpm tsx scripts/db/test-a01-instagram-sa.ts
 *
 * Pre-requisites:
 *   - n8n workflow imported and in "Execute" / Active mode
 *   - ngrok running:  ngrok http 3000
 *   - Next.js running: pnpm dev  (in apps/web)
 *
 * Flow after script completes:
 *   Admin  →  /admin/content-release  →  Release button  →  status='pending'
 *   Client →  /{slug}/calendar  (login with credentials printed below)
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { createHmac, randomUUID } from 'node:crypto'
import { loadEnv, getPgConnectionString, requireEnv } from './lib/env.js'

// ── Brand config ──────────────────────────────────────────────────────────────
const BRAND = {
  email:           'test.najdcoffee@openclaw.dev',
  password:        'Test@1234!',
  brand_name_ar:   'قهوة نجد',
  brand_name_en:   'Najd Coffee',
  sector:          'F&B',
  city:            'Riyadh',
  dialect:         'Najdi',
  price:           'mid_market',
  differentiator:  'Authentic Saudi qahwa and specialty coffee — crafted in Najdi tradition with modern flair',
  formality:       'casual',
  humor:           'light',
  religion:        'High',
  bilingual:       'arabic_primary',
  ramadan:         'High',
  eid_fitr:        'High',
  eid_adha:        'High',
  national_day:    'Critical',
  founding_day:    'High',
  channel:         'Instagram',
  tier:            'paid_pro',
  pipeline:        'Pro',
  batch_shard:     1,              // Monday shard
  color:           '#4A2C0A',
  completeness:    90,
  calendars_done:  0,
  ig_handle:       '@najdcoffee',
  followers:       95000,
  engagement:      0.052,
  style:           'warm arabic coffee atmosphere, golden light, traditional dallah pots, handcrafted details',
  palette:         ['#4A2C0A', '#D4AF37', '#F5F0E8'],
  audience_ar:     'شباب ومهنيون سعوديون 20-40 سنة، يقدّرون القهوة السعودية الأصيلة والتجارب المميزة',
  gender:          '{"male":0.52,"female":0.48}',
  age:             '{"min":20,"max":40}',
}

// ── Webhook ───────────────────────────────────────────────────────────────────
const N8N_BASE_URL   = 'https://ogzstudios.app.n8n.cloud'
const WEBHOOK_PATH   = '/webhook-test/openclaw-batch-calendar'
const TARGET_MONTH   = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

// ── DB connect with retry ─────────────────────────────────────────────────────
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
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw new Error('DB unreachable. Check SUPABASE_DB_URL in .env.local')
}

// ── Phase 1: seed brand ───────────────────────────────────────────────────────
async function seedBrand(secret: string): Promise<{ brand_id: string; slug: string; auth_user_id: string }> {
  const supabaseUrl = requireEnv('SUPABASE_URL')
  const serviceKey  = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const supabase    = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Auth user
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email:          BRAND.email,
    password:       BRAND.password,
    email_confirm:  true,
    user_metadata:  { brand_name_ar: BRAND.brand_name_ar },
  })
  let authUserId: string
  if (createErr) {
    const { data: list } = await supabase.auth.admin.listUsers()
    const existing = list?.users.find(u => u.email === BRAND.email)
    if (!existing) throw new Error(`Cannot create/find user ${BRAND.email}: ${createErr.message}`)
    authUserId = existing.id
    console.log(`  · reusing auth user  ${authUserId}`)
  } else {
    authUserId = created.user.id
    console.log(`  · created auth user  ${authUserId}`)
  }

  const c = await connectDb()
  try {
    // 2. Wipe prior brand + calendar for this user
    const { rowCount: del } = await c.query(
      `delete from public.brand_profiles where auth_user_id = $1`, [authUserId]
    )
    if ((del ?? 0) > 0) console.log(`  · removed ${del} prior brand(s)`)

    // 3. New IDs + slug
    const { rows: [{ brand_id }] } = await c.query<{ brand_id: string }>(
      `select gen_random_uuid()::text as brand_id`
    )
    const suffix = Math.random().toString(36).slice(2, 6)
    const slug   = `najd-coffee-${suffix}`
    console.log(`  · brand_id  ${brand_id}`)
    console.log(`  · slug      ${slug}`)

    await c.query('begin')
    try {
      // brand_profiles
      await c.query(
        `insert into public.brand_profiles
          (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
           price_position, brand_differentiator, formality_level, humor_tolerance,
           religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
           eid_adha_relevance, national_day_relevance, founding_day_relevance,
           primary_channel, tier, pipeline_tier, batch_shard, client_slug,
           primary_color_hex, completeness_score, total_calendars_generated, auth_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [
          brand_id, BRAND.brand_name_ar, BRAND.brand_name_en, BRAND.sector, BRAND.city, BRAND.dialect,
          BRAND.price, BRAND.differentiator, BRAND.formality, BRAND.humor,
          BRAND.religion, BRAND.bilingual, BRAND.ramadan, BRAND.eid_fitr,
          BRAND.eid_adha, BRAND.national_day, BRAND.founding_day,
          BRAND.channel, BRAND.tier, BRAND.pipeline, BRAND.batch_shard, slug,
          BRAND.color, BRAND.completeness, BRAND.calendars_done, authUserId,
        ]
      )

      // audience_profiles
      await c.query(
        `insert into public.audience_profiles (brand_id, description_ar, gender_mix, age_range, language_preference)
         values ($1,$2,$3::jsonb,$4::jsonb,$5)`,
        [brand_id, BRAND.audience_ar, BRAND.gender, BRAND.age, BRAND.bilingual]
      )

      // visual_style_profiles
      await c.query(
        `insert into public.visual_style_profiles (brand_id, style_descriptor, color_palette, platform_specs)
         values ($1,$2,$3,$4::jsonb)`,
        [
          brand_id, BRAND.style, BRAND.palette,
          JSON.stringify({ canvas: '1080x1080', safe_zone: 'bottom-third' }),
        ]
      )

      // channel_profiles
      await c.query(
        `insert into public.channel_profiles (brand_id, channel, handle, followers_count, engagement_rate, synced_at)
         values ($1,$2,$3,$4,$5, now() - interval '1 hour')`,
        [brand_id, BRAND.channel, BRAND.ig_handle, BRAND.followers, BRAND.engagement]
      )

      // evidence_bundles — 10 critical fields
      await c.query(
        `insert into public.evidence_bundles
          (brand_id, field_name, agreement_ratio, recency_score, conflict_score, field_confidence)
         values
          ($1,'arabic_dialect',         1.00,1.00,0.00,'explicitly_confirmed'),
          ($1,'brand_differentiator',   0.90,0.95,0.05,'inferred_high'),
          ($1,'price_position',         0.85,0.90,0.05,'inferred_high'),
          ($1,'primary_channel',        1.00,1.00,0.00,'explicitly_confirmed'),
          ($1,'ramadan_relevance',      0.95,1.00,0.00,'explicitly_confirmed'),
          ($1,'primary_audience_gender',0.80,0.85,0.10,'inferred_high'),
          ($1,'primary_kpi_type',       0.75,0.80,0.15,'inferred_medium'),
          ($1,'religious_sensitivity',  0.85,0.90,0.05,'inferred_high'),
          ($1,'tone_anti_attributes',   0.70,0.75,0.15,'inferred_medium'),
          ($1,'bilingual_ratio',        1.00,1.00,0.00,'explicitly_confirmed')`,
        [brand_id]
      )

      // confidence_classification
      await c.query(
        `insert into public.confidence_classifications (brand_id, mode, reasons)
         values ($1,'Standard','["all 10 critical fields confirmed or inferred_high"]'::jsonb)`,
        [brand_id]
      )

      // source_records
      await c.query(
        `insert into public.source_records (brand_id, source_type, raw_payload, recency_score)
         values
          ($1,'form',         '{"submitted":"15-question onboarding","fields_filled":15}'::jsonb, 1.00),
          ($1,'instagram',    '{"posts_scraped":30,"avg_engagement":0.052}'::jsonb, 0.95),
          ($1,'google_places','{"category":"F&B","rating":4.7,"reviews":210}'::jsonb, 0.90)`,
        [brand_id]
      )

      // brand_snapshot
      await c.query(
        `insert into public.brand_snapshots (brand_id, is_partial, snapshot_data)
         values ($1, false, $2::jsonb)`,
        [brand_id, JSON.stringify({
          tones:             ['authentic_saudi', 'warm_casual', 'coffee_culture'],
          visual_style:      BRAND.style.slice(0, 80),
          audience:          BRAND.audience_ar,
          completeness:      BRAND.completeness,
          dialect_confirmed: true,
        })]
      )

      // branddna_event_log
      await c.query(
        `insert into public.branddna_event_log (brand_id, event_type, event_data)
         values
          ($1,'source_ingested',  '{"source":"onboarding_form","fields":15}'::jsonb),
          ($1,'client_confirmed', '{"field":"arabic_dialect","value":"Najdi"}'::jsonb),
          ($1,'client_confirmed', '{"field":"primary_channel","value":"Instagram"}'::jsonb)`,
        [brand_id]
      )

      await c.query('commit')
      console.log(`  ✓ brand seeded — shard=${BRAND.batch_shard} tier=${BRAND.tier}`)
      return { brand_id, slug, auth_user_id: authUserId }

    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    }
  } finally {
    await c.end().catch(() => {})
  }
}

// ── Phase 2: fire webhook ─────────────────────────────────────────────────────
async function fireWebhook(secret: string, brandId: string): Promise<boolean> {
  const requestId = randomUUID()
  const timestamp = new Date().toISOString()
  const bodyObj   = { brand_id: brandId }
  const rawBody   = JSON.stringify(bodyObj)
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')
  const url       = `${N8N_BASE_URL}${WEBHOOK_PATH}`

  console.log(`\n── Firing N8N-A01 ────────────────────────────────────`)
  console.log(`  webhook : ${url}`)
  console.log(`  brand   : ${brandId}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type':           'application/json',
      'x-n8n-signature':        signature,
      'x-n8n-request-id':       requestId,
      'x-n8n-timestamp':        timestamp,
      'x-n8n-idempotency-key':  brandId,
    },
    body: rawBody,
    signal: AbortSignal.timeout(15_000),
  })

  const detail = await res.text().catch(() => '')
  if (res.ok) {
    console.log(`  → n8n accepted (${res.status}) — workflow running`)
    return true
  } else {
    console.error(`  ✗ n8n rejected (${res.status}): ${detail.slice(0, 300)}`)
    return false
  }
}

// ── Phase 3: poll DB ──────────────────────────────────────────────────────────
async function pollCalendar(brandId: string, slug: string): Promise<void> {
  const c          = await connectDb()
  const deadline   = Date.now() + 10 * 60 * 1000   // 10 min
  let lastStatus   = ''
  let lastCount    = -1

  console.log(`\n── Polling for calendar (target month: ${TARGET_MONTH}) ──`)
  console.log('  (every 10 s · timeout 10 min)')

  try {
    while (Date.now() < deadline) {
      // calendar row
      const cal = await c.query<{
        calendar_id: string; status: string; created_at: string
      }>(
        `select calendar_id, status, created_at
           from public.calendars
          where brand_id = $1 and month = $2
          limit 1`,
        [brandId, TARGET_MONTH]
      )

      if (cal.rowCount === 0) {
        process.stdout.write('.')
        await new Promise(r => setTimeout(r, 10_000))
        continue
      }

      const { calendar_id, status } = cal.rows[0]

      // post count
      const pc = await c.query<{ count: string }>(
        `select count(*) from public.calendar_posts where calendar_id = $1`,
        [calendar_id]
      )
      const count = parseInt(pc.rows[0].count, 10)

      const ts = new Date().toISOString().slice(11, 19)
      if (status !== lastStatus || count !== lastCount) {
        console.log(`\n  [${ts}]  calendar.status=${status}  posts=${count}`)
        lastStatus = status
        lastCount  = count
      }

      if (count > 0) {
        // breakdown by route
        const routes = await c.query<{ route_decision: string; cnt: string }>(
          `select coalesce(route_decision,'unknown') as route_decision, count(*) as cnt
             from public.calendar_posts where calendar_id = $1
            group by route_decision`,
          [calendar_id]
        )
        const generated = await c.query<{ count: string }>(
          `select count(*) from public.calendar_posts
            where calendar_id=$1 and status='generated'`, [calendar_id]
        )
        const genCount = parseInt(generated.rows[0].count, 10)

        // 3 sample posts
        const sample = await c.query<{
          post_id: string; status: string; posting_time: string
          caption_ar: string; route_decision: string; confidence_score: number
        }>(
          `select post_id, status, posting_time, caption_ar, route_decision, confidence_score
             from public.calendar_posts
            where calendar_id=$1
            order by posting_time
            limit 3`,
          [calendar_id]
        )

        console.log(`\n${'═'.repeat(56)}`)
        console.log(`✓ CALENDAR GENERATED — ${BRAND.brand_name_ar} (${BRAND.brand_name_en})`)
        console.log(`${'═'.repeat(56)}`)
        console.log(`  calendar_id : ${calendar_id}`)
        console.log(`  total posts : ${count}`)
        console.log(`  generated   : ${genCount}  ← ready for admin release`)
        console.log(`  held/draft  : ${count - genCount}  ← watermarked or QA held`)
        console.log()

        for (const r of routes.rows) {
          console.log(`  route ${r.route_decision.padEnd(12)}: ${r.cnt} post(s)`)
        }

        if (sample.rowCount && sample.rowCount > 0) {
          console.log('\n  Sample posts:')
          for (const p of sample.rows) {
            const day   = p.posting_time?.slice(0, 10) ?? '?'
            const score = p.confidence_score ? ` [${Math.round(p.confidence_score)}%]` : ''
            const cap   = (p.caption_ar ?? '').slice(0, 90)
            console.log(`    [${day}]${score} ${p.route_decision ?? p.status}`)
            console.log(`      ${cap}`)
          }
        }

        console.log(`\n${'─'.repeat(56)}`)
        console.log('NEXT STEPS')
        console.log(`${'─'.repeat(56)}`)
        console.log(`\n1. Admin — release posts:`)
        console.log(`   http://localhost:3000/admin/content-release`)
        console.log(`   → click Release on each post → status becomes 'pending'`)
        console.log(`\n2. Client login:`)
        console.log(`   URL   : http://localhost:3000/${slug}/calendar`)
        console.log(`   email : ${BRAND.email}`)
        console.log(`   pass  : ${BRAND.password}`)
        console.log(`\n3. Client approves post → status='approved' → N8N-P01 publishes`)
        console.log()
        return
      }

      await new Promise(r => setTimeout(r, 10_000))
    }

    console.log(`\n✗ TIMEOUT — calendar not generated after 10 min.`)
    console.log('  Check n8n.cloud → Executions tab for errors.')
  } finally {
    await c.end().catch(() => {})
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv()
  const secret = requireEnv('N8N_WEBHOOK_SECRET').trim()

  console.log('══════════════════════════════════════════════════════')
  console.log('A01 End-to-End Test — قهوة نجد (Najd Coffee)')
  console.log(`Target month : ${TARGET_MONTH}`)
  console.log(`Shard        : ${BRAND.batch_shard}  (Monday)`)
  console.log(`Channel      : ${BRAND.channel}  ${BRAND.ig_handle}`)
  console.log('══════════════════════════════════════════════════════')

  // Phase 1 — create brand
  console.log('\n── Seeding brand ────────────────────────────────────')
  const { brand_id, slug } = await seedBrand(secret)

  // Phase 2 — fire A01
  const accepted = await fireWebhook(secret, brand_id)
  if (!accepted) {
    console.error('\n✗ Webhook rejected. Check n8n is in Execute/Active mode.')
    process.exit(1)
  }

  // Phase 3 — poll
  await pollCalendar(brand_id, slug)
}

main().catch(e => {
  console.error('✗ test failed:', e.message)
  process.exit(1)
})
