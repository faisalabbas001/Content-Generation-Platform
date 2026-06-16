/**
 * One-shot end-to-end test: POSTs an HMAC-signed trigger to the n8n.cloud
 * webhook for N8N-A02 with a real brand_id, then watches Supabase for the
 * resulting rows.
 *
 * Mirrors exactly what apps/web/src/app/api/posts/on-demand/route.ts sends —
 * same body shape, same HMAC scheme, same headers — so this test exercises
 * the n8n workflow as if a real form submission triggered it.
 *
 * Throwaway. Deleted after the test.
 */
import pg from 'pg'
import { createHmac, randomUUID } from 'node:crypto'
import { loadEnv, getPgConnectionString } from './lib/env.js'

const N8N_URL    = 'https://ogztudios.app.n8n.cloud/webhook/openclaw-a02'
const TEST_SLUG  = 'new-ortiga-v89y'   // existing brand with an auth user

async function main(): Promise<void> {
  loadEnv()
  const secret = process.env.N8N_WEBHOOK_SECRET
  if (!secret) throw new Error('N8N_WEBHOOK_SECRET missing in .env.local')

  const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await c.connect()

  // Resolve the brand row.
  const r = await c.query(
    `select brand_id, brand_name_ar, brand_name_en, client_slug, sector, arabic_dialect, auth_user_id
       from public.brand_profiles where client_slug = $1 limit 1`,
    [TEST_SLUG],
  )
  if (r.rowCount === 0) throw new Error(`brand ${TEST_SLUG} not found`)
  const brand = r.rows[0] as { brand_id: string; brand_name_ar: string; client_slug: string; sector: string; arabic_dialect: string | null; auth_user_id: string | null }
  console.log('Using brand:', brand.client_slug, '|', brand.brand_name_ar, '|', brand.brand_id)

  // 1. Insert the on_demand_requests row exactly as the OGz Studios API would,
  //    so the workflow has somewhere to UPDATE.
  const insertResult = await c.query(
    `insert into public.on_demand_requests (
        brand_id, submitted_by,
        content_type, objective, platform, posting_time, month, posts_per_week,
        occasion_name, occasion_lead_weeks, occasion_priority, hashtags,
        style_descriptor, hero_concept, negative_prompt, cultural_guidance,
        canvas, color_palette,
        image_model_pref, first_ever_post, overlay_brand_name_ar,
        status
     ) values (
        $1, $2,
        'lifestyle','engagement','Instagram', null, '2026-04', 1,
        null, 0, null, '{}'::text[],
        'minimal flat lay, soft natural light, marble surface',
        'a single white ceramic cup of arabic coffee with dates on a marble surface',
        'no people, no text, no logos', 'modest, family-friendly composition',
        'ig_square', '{"#1a1a1a","#d4af37"}'::text[],
        'auto', false, true,
        'queued'
     ) returning request_id`,
    [brand.brand_id, brand.auth_user_id],
  )
  const requestId = (insertResult.rows[0] as { request_id: string }).request_id
  console.log('Inserted on_demand_requests:', requestId)

  // 2. Build the trigger body — must match OGz Studios's outbound shape.
  const insertPayload = {
    brand_id:              brand.brand_id,
    submitted_by:          brand.auth_user_id,
    content_type:          'lifestyle',
    objective:             'engagement',
    platform:              'Instagram',
    posting_time:          null,
    month:                 '2026-04',
    posts_per_week:        1,
    occasion_name:         null,
    occasion_lead_weeks:   0,
    occasion_priority:     null,
    hashtags:              [],
    style_descriptor:      'minimal flat lay, soft natural light, marble surface',
    hero_concept:          'a single white ceramic cup of arabic coffee with dates on a marble surface',
    negative_prompt:       'no people, no text, no logos',
    cultural_guidance:     'modest, family-friendly composition',
    canvas:                'ig_square',
    color_palette:         ['#1a1a1a', '#d4af37'],
    image_model_pref:      'auto',
    first_ever_post:       false,
    overlay_brand_name_ar: true,
    status:                'queued',
  }

  const triggerBody = {
    flow_id: 'N8N-A02',
    event: 'on_demand_post_requested',
    request_id: requestId,
    brand_id: brand.brand_id,
    client_slug: brand.client_slug,
    submitted_by: brand.auth_user_id,
    brief: insertPayload,
  }
  const rawBody = JSON.stringify(triggerBody)
  const timestamp = new Date().toISOString()
  const n8nRequestId = randomUUID()
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')

  console.log('')
  console.log('Calling n8n webhook:', N8N_URL)
  console.log('  request_id     :', requestId)
  console.log('  n8n_request_id :', n8nRequestId)
  console.log('  body bytes     :', rawBody.length)
  console.log('')

  // 3. Fire the trigger.
  const startedAt = Date.now()
  const res = await fetch(N8N_URL, {
    method: 'POST',
    headers: {
      'content-type':           'application/json',
      'x-n8n-signature':        signature,
      'x-n8n-request-id':       n8nRequestId,
      'x-n8n-timestamp':        timestamp,
      'x-n8n-idempotency-key':  requestId,
    },
    body: rawBody,
    signal: AbortSignal.timeout(15_000),
  })
  console.log(`n8n responded ${res.status} in ${Date.now() - startedAt}ms`)
  const text = await res.text().catch(() => '')
  console.log('  body:', text.slice(0, 400))

  if (res.ok) {
    // record n8n_request_id so we can correlate later if needed
    await c.query(
      `update public.on_demand_requests set n8n_request_id = $1, status = 'generating' where request_id = $2`,
      [n8nRequestId, requestId],
    )
  } else {
    console.log('Trigger rejected. Marking the row failed and exiting.')
    await c.query(
      `update public.on_demand_requests set status = 'failed', failure_reason = $1 where request_id = $2`,
      [`n8n_${res.status}`, requestId],
    )
    await c.end()
    process.exit(1)
  }

  // 4. Poll for terminal state — up to 4 minutes (within the < 5 min SLA).
  console.log('')
  console.log('Watching on_demand_requests.status (poll every 5s, up to 4 min)...')
  const deadline = Date.now() + 4 * 60 * 1000
  let lastStatus = 'generating'
  while (Date.now() < deadline) {
    const r2 = await c.query(
      `select status, post_id, confidence_mode, failure_reason, delivered_at
         from public.on_demand_requests where request_id = $1`,
      [requestId],
    )
    const row = r2.rows[0] as { status: string; post_id: string | null; confidence_mode: string | null; failure_reason: string | null; delivered_at: Date | null }
    if (row.status !== lastStatus) {
      console.log(`  [${new Date().toISOString().slice(11, 19)}]  status: ${row.status}`)
      lastStatus = row.status
    }
    if (row.status === 'delivered' || row.status === 'held' || row.status === 'failed') {
      console.log('')
      console.log('=== TERMINAL STATE ===')
      console.log('  status        :', row.status)
      console.log('  post_id       :', row.post_id)
      console.log('  confidence    :', row.confidence_mode)
      console.log('  failure_reason:', row.failure_reason)
      console.log('  delivered_at  :', row.delivered_at?.toISOString())

      if (row.status === 'delivered' && row.post_id) {
        const p = await c.query(
          `select caption_ar, hashtags, content_type, route_decision, watermark, storage_url, confidence_score
             from public.calendar_posts where post_id = $1`,
          [row.post_id],
        )
        const post = p.rows[0] as Record<string, unknown> | undefined
        if (post) {
          console.log('')
          console.log('=== calendar_posts ===')
          console.log('  caption_ar      :', post.caption_ar)
          console.log('  hashtags        :', post.hashtags)
          console.log('  route_decision  :', post.route_decision)
          console.log('  watermark       :', post.watermark)
          console.log('  confidence_score:', post.confidence_score)
          console.log('  storage_url     :', post.storage_url)
        }
      }
      if (row.status === 'held') {
        const q = await c.query(
          `select caption_ar, cco_score, trigger_reason from public.qa_review_queue
             where brand_id = $1 order by created_at desc limit 1`,
          [brand.brand_id],
        )
        if (q.rowCount && q.rowCount > 0) {
          console.log('')
          console.log('=== qa_review_queue (latest for brand) ===')
          console.log(' ', q.rows[0])
        }
      }
      break
    }
    await new Promise((rs) => setTimeout(rs, 5000))
  }

  if (lastStatus === 'generating') {
    console.log('')
    console.log('TIMEOUT — still generating after 4 min. Check n8n.cloud Executions tab.')
  }

  await c.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
