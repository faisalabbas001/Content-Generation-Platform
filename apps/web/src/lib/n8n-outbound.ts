/**
 * Outbound HMAC-signed POST to n8n.
 *
 * Mirrors the inbound auth contract (lib/n8n-auth.ts) so n8n can verify
 * requests OUR side originates with the same shared secret + the same
 * `x-n8n-*` headers. n8n flows that receive these calls (N8N-A03, N8N-A04,
 * etc.) typically include a Function node up front that re-computes the
 * HMAC and rejects on mismatch.
 *
 * Use cases:
 *   - Onboarding form submission   → POST {N8N_INBOUND_URL}{N8N_A03_WEBHOOK_PATH}
 *   - Brand correction request     → POST {N8N_INBOUND_URL}{N8N_A04_WEBHOOK_PATH}
 *   - On-demand post generation    → POST {N8N_INBOUND_URL}/webhook/on-demand-post
 *
 * Design choices:
 *   - Fire-and-forget (no awaitable retry loop) — the form must return fast.
 *     If n8n is down we log + still let the user proceed; an admin script can
 *     re-trigger the flow later by re-reading source_records.
 *   - Strict timeout (5s default) so a slow n8n doesn't block the request.
 *   - All env reads happen at call time so `pnpm db:swap` + ngrok URL changes
 *     take effect without a rebuild.
 */
import { createHmac, randomUUID } from 'node:crypto'

export interface TriggerOptions {
  /** Path on n8n side, e.g. `/webhook/openclaw-onboarding`. */
  path: string
  /** Body to POST. Will be `JSON.stringify`'d and signed. */
  body: Record<string, unknown>
  /** Optional override — defaults to N8N_INBOUND_URL from env. */
  baseUrl?: string
  /** Hard timeout in ms; default 5000 (form submit must stay snappy). */
  timeoutMs?: number
  /**
   * Optional idempotency key. If provided, n8n's inbound dedupe (when
   * implemented in the flow) ignores duplicates within 5 min.
   */
  idempotencyKey?: string
}

export interface TriggerResult {
  ok: boolean
  status?: number
  request_id: string
  error?: string
}

/**
 * Send an HMAC-signed POST to an n8n webhook. Returns success/failure shape;
 * never throws — callers can decide whether to surface errors to the user.
 */
export async function triggerN8n(opts: TriggerOptions): Promise<TriggerResult> {
  const requestId = randomUUID()
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return { ok: false, request_id: requestId, error: 'N8N_WEBHOOK_SECRET is not set' }
  }
  const baseUrl = (opts.baseUrl ?? process.env.N8N_INBOUND_URL ?? '').trim().replace(/\/+$/, '')
  if (!baseUrl) {
    return { ok: false, request_id: requestId, error: 'N8N_INBOUND_URL is not set' }
  }
  const path = opts.path.trim()
  if (!path) {
    return { ok: false, request_id: requestId, error: 'n8n webhook path is not set' }
  }

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const rawBody = JSON.stringify(opts.body)
  const ts = new Date().toISOString()
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex')

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-n8n-signature': signature,
    'x-n8n-request-id': requestId,
    'x-n8n-timestamp': ts,
  }
  if (opts.idempotencyKey) headers['x-n8n-idempotency-key'] = opts.idempotencyKey

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000)

  console.info(`[triggerN8n] POST ${url} (request_id=${requestId})`)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    })
    if (!res.ok) {
      // Try to read the response body for diagnostics — n8n cloud returns
      // helpful JSON like {"code":404,"message":"webhook not registered"}.
      let detail = ''
      try { detail = (await res.text()).slice(0, 300) } catch { /* ignore */ }
      console.warn(
        `[triggerN8n] non-2xx ${res.status} from ${url} request_id=${requestId} body=${detail}`,
      )
      return { ok: false, status: res.status, request_id: requestId, error: detail || `HTTP ${res.status}` }
    }
    console.info(`[triggerN8n] ${res.status} OK ${url} request_id=${requestId}`)
    return { ok: true, status: res.status, request_id: requestId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[triggerN8n] fetch threw for ${url} request_id=${requestId} err=${message}`)
    return {
      ok: false,
      request_id: requestId,
      error: message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** Convenience wrappers — one per flow. Read paths from env at call time. */

export function triggerN8nA03Onboarding(body: Record<string, unknown>) {
  return triggerN8n({
    path: process.env.N8N_A03_WEBHOOK_PATH ?? '/webhook-test/openclaw-onboarding',
    body,
  })
}

export function triggerN8nA04Correction(body: Record<string, unknown>) {
  return triggerN8n({
    path: process.env.N8N_A04_WEBHOOK_PATH ?? '/webhook-test/openclaw-correction',
    body,
    timeoutMs: 10000,
  })
}

/**
 * v2 — Section 1 of onboarding fires this. A06 owns scraping; A03 reads
 * results from source_records when triggered later by Section 3.
 *
 * We use a short timeout becauseA06 replies 202 within ~200ms and the
 * actual scraping happens after the response. If A06 is unreachable, the
 * onboarding flow degrades: extraction is skipped, Section 2 shows empty
 * fields, user fills manually.
 */
/** N8N-A01 — Content generation batch. Triggered on strategy approval.
 *  Runs CEO → COO → DeepSeek → CCO → V01 pipeline for one brand/month. */
export function triggerN8nA01ContentGeneration(body: Record<string, unknown>) {
  return triggerN8n({
    path: process.env.N8N_A01_WEBHOOK_PATH ?? '/webhook-test/openclaw-content-generation',
    body,
    timeoutMs: 10000,
  })
}

/** N8N-A01 Batch Calendar — triggered from the "Approve & Generate" button on
 *  the strategy-review page. Hits the openclaw-batch-calendar webhook which
 *  kicks off the full weekly/monthly calendar generation pipeline for the brand.
 *  Body shape: { brand_id, source } — matches the n8n flow's expected input. */
export function triggerN8nA01BatchCalendar(brandId: string, source = 'strategy-approval') {
  return triggerN8n({
    path: process.env.N8N_A01_BATCH_CALENDAR_WEBHOOK_PATH ?? '/webhook-test/openclaw-batch-calendar',
    body: { brand_id: brandId, source },
    timeoutMs: 10000,
    idempotencyKey: `batch-calendar-${brandId}`,
  })
}

export function triggerN8nA06Extraction(body: Record<string, unknown>) {
  return triggerN8n({
    path: process.env.N8N_A06_WEBHOOK_PATH ?? '/webhook/openclaw-extraction',
    body,
    timeoutMs: 8000,
  })
}

/** N8N-A07 — Competitor extraction. Triggered after A03 onboarding when
 *  competitor_accounts have been seeded. Fire-and-forget (8s timeout). */
export function triggerN8nA07CompetitorExtraction(body: Record<string, unknown>) {
  return triggerN8n({
    path: process.env.N8N_A07_WEBHOOK_PATH ?? '/webhook-test/competitor-extraction',
    body,
    timeoutMs: 8000,
  })
}

export function triggerN8nP01InstagramPublisher(body: Record<string, unknown>) {
  return triggerN8n({
    baseUrl: process.env.N8N_INBOUND_URL ?? 'https://ogzstudios.app.n8n.cloud',
    path: process.env.N8N_P01_WEBHOOK_PATH ?? '/webhook/openclaw-instagram-publisher',
    body,
    timeoutMs: 8000,
  })
}

/**
 * Called after an admin approves a QA-held post.
 * N8N uses this to trigger downstream processing (publishing, client notification).
 * Only fired when post_id is present — no-op for caption-only queue items.
 */
export function triggerN8nQaApproved(body: Record<string, unknown>) {
  return triggerN8n({
    baseUrl: process.env.N8N_QA_APPROVED_BASE_URL,
    path: process.env.N8N_QA_APPROVED_WEBHOOK_PATH ?? '/webhook/openclaw-qa-approved',
    body,
    timeoutMs: 8000,
  })
}

/**
 * Called after an admin rejects a QA-held post.
 * Mirrors triggerN8nQaApproved — sends decision:'rejected' so the n8n flow
 * can handle cleanup / user notification downstream.
 */
export function triggerN8nQaRejected(body: Record<string, unknown>) {
  return triggerN8n({
    baseUrl: process.env.N8N_QA_REJECTED_BASE_URL ?? process.env.N8N_QA_APPROVED_BASE_URL,
    path: process.env.N8N_QA_REJECTED_WEBHOOK_PATH ?? '/webhook/openclaw-qa-rejected',
    body,
    timeoutMs: 8000,
  })
}

/**
 * N8N-A01 batch calendar trigger — admin-initiated, single-brand override.
 * Sends brand_id so the "Prepare Batch Config" node forces MONTHLY mode for
 * that brand only. Uses the webhook-test URL (same as the cron scheduler).
 */
export function triggerN8nA01BatchCalendarAdmin(body: Record<string, unknown>) {
  return triggerN8n({
    baseUrl: process.env.N8N_INBOUND_URL ?? 'https://ogzstudios.app.n8n.cloud',
    path: process.env.N8N_A01_BATCH_WEBHOOK_PATH ?? '/webhook-test/openclaw-batch-calendar',
    body,
    timeoutMs: 15000,
  })
}

/**
 * 3-Month Rolling Calendar — "Offset Orchestrator".
 *
 * Fires N8N-A01 once PER month_offset (default [0,1,2]) for a single brand, so
 * each A01 run stays a small, bounded single-month job (current month + the next
 * two). Calls are SEQUENTIAL (awaited) so the three DeepSeek bursts don't overlap
 * and overwhelm the API. A01's `Prepare Batch Config` already reads `month_offset`
 * (0-2) and forces a full month for offset>0; all A01 DB writes are idempotent
 * (on_conflict brand_id,month + calendar_id,position), so a re-fired offset is
 * safe — never duplicates skeletons.
 *
 * Each offset gets its own idempotency key so retrying one month doesn't collide
 * with another. One offset failing does NOT abort the others.
 *
 * Returns one TriggerResult per offset (same order as `offsets`).
 */
export async function triggerN8nA01ForMonths(
  brandId: string,
  offsets: number[] = [0, 1, 2],
  source = 'onboarding-complete',
  opts: { off_days?: number[]; posts_per_week?: number } = {},
): Promise<TriggerResult[]> {
  const results: TriggerResult[] = []
  for (const offset of offsets) {
    const r = await triggerN8n({
      baseUrl: process.env.N8N_INBOUND_URL ?? 'https://ogzstudios.app.n8n.cloud',
      path: process.env.N8N_A01_BATCH_WEBHOOK_PATH ?? '/webhook-test/openclaw-batch-calendar',
      // month_offset present → A01 forces rolling='single' (one month per call).
      body: {
        brand_id: brandId,
        source,
        month_offset: offset,
        ...(opts.off_days ? { off_days: opts.off_days } : {}),
        ...(typeof opts.posts_per_week === 'number' ? { posts_per_week: opts.posts_per_week } : {}),
      },
      timeoutMs: 15000,
      idempotencyKey: `batch-calendar-${brandId}-m${offset}`,
    }).catch((e): TriggerResult => ({
      ok: false,
      request_id: 'n/a',
      error: e instanceof Error ? e.message : String(e),
    }))
    results.push(r)
    if (!r.ok) {
      console.error(`[A01-offset-orchestrator] brand=${brandId} month_offset=${offset} failed: ${r.error}`)
    }
  }
  return results
}

/**
 * N8N-B03 revision flow. Triggered when the admin approves a user-initiated
 * revision request (NOT directly when the user clicks "Request Changes" —
 * Saudi cultural/religious sensitivity requires admin pre-approval per OGZ
 * doc §5.4 internal-review step).
 */
export function triggerN8nB03Revision(body: Record<string, unknown>) {
  return triggerN8n({
    baseUrl: process.env.N8N_INBOUND_URL ?? 'https://ogzstudios.app.n8n.cloud',
    path: process.env.N8N_B03_WEBHOOK_PATH ?? '/webhook/openclaw-revision',
    body,
    timeoutMs: 10000,
  })
}
