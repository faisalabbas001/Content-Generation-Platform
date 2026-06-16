/**
 * POST /api/posts/on-demand
 *
 * Client-initiated entry point for the N8N-A02 (on-demand single post) flow.
 * Doc §3.2 + §5.1: every generation event flows through CEO first; n8n
 * orchestrates, our /api/agents/* routes hold the prompts (Hard Rule #5).
 *
 * Sequence:
 *   1. Auth: requireBrandAccess(slug) — RLS-backed ownership check.
 *   2. Validate the form body (mirrors fields submitted by on-demand-form.tsx).
 *   3. Insert a row into `on_demand_requests` (status='queued') so we have
 *      a stable correlation id BEFORE we call out to n8n.
 *   4. Sign the trigger payload with N8N_WEBHOOK_SECRET (same HMAC scheme as
 *      lib/n8n-auth.verifyN8nRequest — symmetric inbound + outbound).
 *   5. POST to N8N_WEBHOOK_URL_A02. n8n will:
 *        - call /api/agents/ceo/classify         (Hard Rule #1)
 *        - call /api/agents/coo/compile-caption-context
 *        - call /api/agents/deepseek/generate
 *        - call /api/agents/cco/qc
 *        - call /api/agents/ceo/confidence-gate  (clean | watermark | hold)
 *        - call FAL AI for image (Sharp overlay applied locally)
 *        - upload to Supabase Storage
 *        - POST /api/webhooks/n8n with event_type='on_demand_complete'
 *      We do NOT wait for n8n to finish — we return 202 immediately and the
 *      UI polls / subscribes for status.
 *   6. If the n8n call itself fails, mark the request 'failed' and return 502.
 *
 * Why we use the user-scoped client for the INSERT (and not adminClient):
 *   The 0009 RLS policy `client_own_insert` checks
 *     submitted_by = auth.uid() AND brand_profiles.auth_user_id = auth.uid()
 *   so the database is the source of truth for ownership. We never let the
 *   client trick us into writing into another tenant's row, even if the slug
 *   check above were buggy.
 */
import { NextResponse } from 'next/server'
import { createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getCurrentUser, getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Input schema — kept tight to what on-demand-form.tsx actually submits ──
const HEX = /^#[0-9A-Fa-f]{6}$/
const RequestBody = z.object({
  client_slug: z.string().min(1),

  // Output medium — image (default) or video. Kept separate from content_type
  // so the existing image flow (content_type=lifestyle|offer|…) is untouched.
  // Drives CEO video-chain selection and the V01 video branch downstream.
  media_type:   z.enum(['image', 'video']).default('image'),

  // Caption brief
  content_type: z.enum(['lifestyle', 'offer', 'educational', 'testimonial', 'announcement']),
  objective:    z.enum(['awareness', 'engagement', 'conversion', 'cultural', 'trust']),
  platform:     z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter']),
  posting_time: z.string().datetime().optional().nullable(),
  month:        z.string().regex(/^\d{4}-\d{2}$/),
  posts_per_week: z.coerce.number().int().min(1).max(7).default(1),
  occasion_name: z.string().max(120).optional().nullable(),
  occasion_lead_weeks: z.coerce.number().int().min(0).max(12).optional().nullable(),
  occasion_priority: z.enum(['Critical', 'High', 'Medium', 'Low', 'Not_relevant']).optional().nullable(),
  hashtags: z.array(z.string()).max(30).default([]),

  // Visual brief — Hard Rule #3: English-only. We do not strictly validate
  // ASCII here (the prompt may contain English brand terms); the Doc requires
  // the *intent* to be English, and the UI enforces dir="ltr".
  style_descriptor: z.string().min(10, 'Prompt must be at least 10 characters').max(5000, 'Prompt cannot exceed 5000 characters'),
  hero_concept:     z.string().min(10, 'Prompt must be at least 10 characters').max(5000, 'Prompt cannot exceed 5000 characters'),
  negative_prompt:  z.string().max(2000).optional().nullable(),
  cultural_guidance: z.string().max(2000).optional().nullable(),
  canvas: z.enum(['ig_square', 'ig_portrait', 'ig_story', 'snap']),
  color_palette: z.array(z.string().regex(HEX)).max(8).default([]),

  // Generation controls
  image_model_pref: z.enum(['auto', 'nano_banana', 'flux_ultra', 'fal_flux', 'fal_nano']).default('auto'),
  first_ever_post: z.coerce.boolean().default(false),
  overlay_brand_name_ar: z.coerce.boolean().default(true),
})

type On_DemandStatus = 'queued' | 'generating' | 'delivered' | 'held' | 'failed'

export async function POST(request: Request): Promise<Response> {
  // ── 1. Auth ─────────────────────────────────────────────────────
  const user = await getCurrentUser()
  if (!user) return json(401, { error: 'unauthenticated' })

  // ── 2. Validate body ────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid_json' })
  }
  const parsed = RequestBody.safeParse(body)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_input',
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  const input = parsed.data

  const brand = await getBrandForCurrentUser(input.client_slug)
  if (!brand) return json(403, { error: 'forbidden_brand' })

  // ── 3. Insert on_demand_requests (user-scoped → RLS enforces ownership) ──
  const userDb = await getUserScopedClient()
  const insertPayload = {
    brand_id:              brand.brand_id,
    submitted_by:          user.id,
    media_type:            input.media_type,
    content_type:          input.content_type,
    objective:             input.objective,
    platform:              input.platform,
    posting_time:          input.posting_time ?? null,
    month:                 input.month,
    posts_per_week:        input.posts_per_week,
    occasion_name:         input.occasion_name ?? null,
    occasion_lead_weeks:   input.occasion_lead_weeks ?? 0,
    occasion_priority:     input.occasion_priority ?? null,
    hashtags:              normaliseHashtags(input.hashtags),
    style_descriptor:      input.style_descriptor.trim(),
    hero_concept:          input.hero_concept.trim(),
    negative_prompt:       input.negative_prompt ?? null,
    cultural_guidance:     input.cultural_guidance ?? null,
    canvas:                input.canvas,
    color_palette:         input.color_palette,
    image_model_pref:      input.image_model_pref,
    first_ever_post:       input.first_ever_post,
    overlay_brand_name_ar: input.overlay_brand_name_ar,
    status:                'queued' as On_DemandStatus,
  }

  // Bypass generated Database types — `on_demand_requests` is added in
  // migration 0009 and `pnpm db:types` will regenerate the type file. Until
  // that runs, we cast the client surface to keep TS happy without weakening
  // the per-call type discipline above (insertPayload is fully typed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userDbAny = userDb as any
  const { data: inserted, error: insertErr } = await userDbAny
    .from('on_demand_requests')
    .insert(insertPayload)
    .select('request_id')
    .single()

  if (insertErr || !inserted) {
    console.error('[on-demand] insert failed:', insertErr)
    return json(500, { error: 'insert_failed', message: insertErr?.message ?? 'unknown' })
  }
  const requestId = (inserted as { request_id: string }).request_id

  // ── 4. Sign trigger payload (HMAC matches lib/n8n-auth) ─────────
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
  // Prefer the direct full URL (N8N_WEBHOOK_URL_A02) when set.
  // Fall back to composing from N8N_INBOUND_URL + N8N_A02_WEBHOOK_PATH for
  // deployments that split base/path across separate env vars.
  const directUrl = process.env.N8N_WEBHOOK_URL_A02?.trim()
  const n8nBase   = (process.env.N8N_INBOUND_URL ?? '').trim().replace(/\/+$/, '')
  const n8nPath   = (process.env.N8N_A02_WEBHOOK_PATH ?? '').trim()
  const composedUrl = n8nBase && n8nPath
    ? `${n8nBase}${n8nPath.startsWith('/') ? n8nPath : `/${n8nPath}`}`
    : undefined
  const webhookUrl = directUrl || composedUrl
  if (!secret || !webhookUrl) {
    // Dev convenience: row is queued, n8n is just not wired yet. Tell the
    // client the request was accepted so the UI can render queued state.
    return json(202, {
      ok: true,
      request_id: requestId,
      status: 'queued' as On_DemandStatus,
      note: 'N8N_WEBHOOK_URL_A02 not configured — request stored, n8n not triggered',
    })
  }

  const triggerBody = {
    flow_id: 'N8N-A02',
    event: 'on_demand_post_requested',
    request_id: requestId,
    brand_id: brand.brand_id,
    client_slug: brand.client_slug,
    submitted_by: user.id,
    brief: insertPayload,
  }
  const rawBody = JSON.stringify(triggerBody)
  const timestamp = new Date().toISOString()
  const n8nRequestId = randomUUID()
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')

  // ── 5. Mark 'generating' + fire n8n ─────────────────────────────
  // Status is set BEFORE the n8n call so the UI shows in-progress
  // immediately. n8n owns all subsequent status transitions ('held',
  // 'delivered', 'failed') — we must NOT overwrite after it returns.
  const adminDb = adminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = adminDb as any
  await adminAny
    .from('on_demand_requests')
    .update({ n8n_request_id: n8nRequestId, status: 'generating' })
    .eq('request_id', requestId)

  let triggered = false
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-n8n-signature':       signature,
        'x-n8n-request-id':      n8nRequestId,
        'x-n8n-timestamp':       timestamp,
        'x-n8n-idempotency-key': requestId,
      },
      body: rawBody,
      signal: AbortSignal.timeout(300_000),
    })
    triggered = res.ok
    if (!triggered) {
      const text = await res.text().catch(() => '')
      console.error(`[on-demand] n8n returned ${res.status}: ${text.slice(0, 500)}`)
    }
  } catch (err) {
    console.error('[on-demand] n8n trigger failed:', err)
  }

  // ── 6. Log trigger outcome ───────────────────────────────────────
  // n8n has already written the correct terminal status ('held',
  // 'delivered', 'failed') — do NOT update status here again.
  if (triggered) {
    await adminDb.from('usage_logs').insert({
      flow_id: 'N8N-A02',
      brand_id: brand.brand_id,
      node_name: 'on_demand_trigger',
      duration_ms: 0,
      cost_usd: 0,
      status: 'ok',
      payload: { request_id: requestId, n8n_request_id: n8nRequestId },
    } as never)
    return json(202, { ok: true, request_id: requestId, status: 'generating' as On_DemandStatus })
  }

  // n8n unreachable → mark failed but keep the request row for retry/audit.
  await adminAny
    .from('on_demand_requests')
    .update({ status: 'failed', failure_reason: 'n8n_trigger_unreachable' })
    .eq('request_id', requestId)
  await adminDb.from('anomaly_records').insert({
    brand_id: brand.brand_id,
    anomaly_type: 'n8n_trigger_failed',
    severity: 'error',
    details: { request_id: requestId, webhook_url: webhookUrl },
  } as never)
  return json(502, { error: 'n8n_unreachable', request_id: requestId })
}

// ──────────────────────────────────────────────────────────────────
function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status })
}

/**
 * The form ships hashtags as a single comma/space separated string; our DB
 * column is text[]. Normalise here so the n8n payload + DB row agree.
 *
 * The form passes a string array already if the client did the parsing, or a
 * single string — accept either.
 */
function normaliseHashtags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? [input] : []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    for (const tag of item.split(/[\s,]+/)) {
      const t = tag.trim().replace(/^#+/, '')
      if (t.length > 0 && t.length <= 60) out.push('#' + t)
    }
  }
  // de-dupe, preserve order
  return [...new Set(out)]
}
