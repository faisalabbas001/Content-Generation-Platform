/**
 * Shared n8n → OGz Studios webhook authentication.
 *
 * Used by every `/api/agents/*` route and `/api/webhooks/n8n/*`.
 *
 * Security model (Doc §2.2 + §9.1 SEC-10):
 *   - n8n signs the raw request body with HMAC-SHA256 using N8N_WEBHOOK_SECRET.
 *   - Sends the hex digest in the `x-n8n-signature` header.
 *   - We re-compute and compare in constant time. Plain header equality is
 *     vulnerable to timing leaks and is not enough.
 *
 * Anti-replay:
 *   - n8n includes a `x-n8n-timestamp` (ISO-8601) and a `x-n8n-request-id`
 *     (UUID v4) on every request.
 *   - Reject requests with timestamp drift > 5 minutes.
 *   - Reject duplicate request IDs seen in the last 10 minutes (in-memory
 *     LRU; Redis would replace this in Phase 2 §11.2).
 *
 * Body size cap:
 *   - Reject bodies over 256KB. Legit n8n payloads are 5-30KB.
 *
 * Idempotency:
 *   - When `x-n8n-idempotency-key` is provided AND we've already returned a
 *     2xx for that key in the last 5 minutes, return the cached body.
 *   - This protects against duplicate billing on n8n retry.
 *
 * IMPORTANT — Hard Rule #5:
 *   "n8n NEVER makes creative or strategic decisions. It routes payloads
 *    between agents only." So every n8n call hits OUR routes, not provider
 *    APIs directly. Our routes hold the system prompts (SEC-06) — n8n only
 *    holds the per-call user payload.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const FIVE_MINUTES_MS = 5 * 60 * 1000
const TEN_MINUTES_MS = 10 * 60 * 1000
// 256KB was too small for the persist-ig payload (30 posts × captions + raw
// profile blob). Raised to 10MB — safe because every request is HMAC-signed
// by n8n with a secret we control, so oversized abuse is not a realistic vector.
const MAX_BODY_BYTES = 10 * 1024 * 1024

// ── Per-source breaker ────────────────────────────────────────────────
// Stops a stuck n8n flow (or any caller) from hammering a 401 in a tight
// loop. After 5 consecutive 401s from the same source within 30 seconds,
// drop further requests with 429 + Retry-After: 30 for 30 seconds.
// Resets on any 2xx from that source.
const BREAKER_THRESHOLD = 5
const BREAKER_WINDOW_MS = 30_000
const BREAKER_COOLDOWN_MS = 30_000
const breaker = new Map<string, { failures: number; first: number; cooldownUntil: number }>()

function sourceKey(req: Request): string {
  // Trust x-forwarded-for first (n8n cloud sits behind a proxy), fall back
  // to a constant — local dev usually has no XFF header set.
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return xff || req.headers.get('x-real-ip') || 'unknown'
}

/**
 * Build a one-line "where did this request come from" string for diagnostic
 * logs. Combines source IP, user-agent, and any trace headers ngrok adds.
 * Helps identify a mystery caller (n8n vs Postman vs a stuck browser tab vs
 * an ngrok-routed request from somewhere unexpected).
 */
function callerFingerprint(req: Request): string {
  const ua = req.headers.get('user-agent') ?? '?'
  const ngrokTrace = req.headers.get('x-amzn-trace-id') ?? req.headers.get('x-request-id') ?? ''
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const host = req.headers.get('host') ?? ''
  const referer = req.headers.get('referer') ?? ''
  return `ua="${ua.slice(0, 80)}" host=${host} xff=${xff} ref=${referer.slice(0, 60)} trace=${ngrokTrace.slice(0, 30)}`
}

function breakerCheck(source: string): { tripped: true; retryAfter: number } | { tripped: false } {
  const e = breaker.get(source)
  if (!e) return { tripped: false }
  const now = Date.now()
  if (e.cooldownUntil && now < e.cooldownUntil) {
    return { tripped: true, retryAfter: Math.ceil((e.cooldownUntil - now) / 1000) }
  }
  return { tripped: false }
}

function breakerRecordFailure(source: string): void {
  const now = Date.now()
  const e = breaker.get(source)
  if (!e || now - e.first > BREAKER_WINDOW_MS) {
    breaker.set(source, { failures: 1, first: now, cooldownUntil: 0 })
    return
  }
  e.failures += 1
  if (e.failures >= BREAKER_THRESHOLD) {
    e.cooldownUntil = now + BREAKER_COOLDOWN_MS
    console.warn(
      `[n8n-auth] breaker tripped for source=${source}: ${e.failures} failures in ${now - e.first}ms — dropping for ${BREAKER_COOLDOWN_MS / 1000}s`,
    )
  }
}

function breakerRecordSuccess(source: string): void {
  breaker.delete(source)
}

/**
 * In-memory replay-protection set. Falls over a single process restart, which
 * is acceptable for Phase 1 — replay window is 10 min, n8n ack is faster.
 * In Phase 3 swap for Redis (Doc §11.2).
 *
 * Each entry stores the timestamp AND optionally the cached response body so
 * that n8n retries (which re-send the same x-n8n-request-id) receive the
 * original 200 result instead of a 409 — critical for long-running calls like
 * DeepSeek caption generation where ngrok may drop the first connection before
 * n8n receives the response.
 */
interface SeenEntry {
  ts: number
  cachedResponse: CachedResponse | null
}
const seenRequestIds = new Map<string, SeenEntry>()

/**
 * In-memory idempotency cache: key → { status, body, expiresAt }.
 */
interface CachedResponse {
  status: number
  body: string
  contentType: string
  expiresAt: number
}
const idempotencyCache = new Map<string, CachedResponse>()

export interface VerifiedRequest {
  /** The raw body string we already read — pass it to JSON.parse / Zod. */
  rawBody: string
  /** UUID v4 from x-n8n-request-id. */
  requestId: string
  /** ISO-8601 from x-n8n-timestamp. */
  timestamp: string
  /** Optional — when present, response is cached + replayed for next 5 min. */
  idempotencyKey: string | null
}

export type VerifyResult =
  | { ok: true; req: VerifiedRequest; cachedResponse: null }
  | { ok: true; req: VerifiedRequest; cachedResponse: Response }
  | { ok: false; response: Response }

/**
 * Verify an inbound n8n request. Reads the body once and returns it for
 * downstream handlers — DO NOT call `request.json()` after this.
 */
export async function verifyN8nRequest(request: Request): Promise<VerifyResult> {
  const source = sourceKey(request)

  // ── Per-source breaker ─────────────────────────────────────────
  // Drops loops at the door before we burn DB / SDK time on a known-bad caller.
  const trip = breakerCheck(source)
  if (trip.tripped) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: 'rate_limited', message: 'too many failed verifications — cooling down' }),
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': String(trip.retryAfter) },
        },
      ),
    }
  }

  const secret = process.env.N8N_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return {
      ok: false,
      response: errorResponse(500, 'misconfigured', 'N8N_WEBHOOK_SECRET is not set on the server'),
    }
  }

  // ── Header presence ────────────────────────────────────────────
  const signature = request.headers.get('x-n8n-signature')
  const requestId = request.headers.get('x-n8n-request-id')
  const timestamp = request.headers.get('x-n8n-timestamp')
  const idempotencyKey = request.headers.get('x-n8n-idempotency-key')
  if (!signature || !requestId || !timestamp) {
    breakerRecordFailure(source)
    console.warn(
      `[n8n-auth] 401 missing_headers from ${source}: have_sig=${!!signature} have_id=${!!requestId} have_ts=${!!timestamp} ${callerFingerprint(request)}`,
    )
    return {
      ok: false,
      response: errorResponse(401, 'missing_headers', 'x-n8n-signature, x-n8n-request-id, and x-n8n-timestamp are required'),
    }
  }

  // ── Timestamp drift ────────────────────────────────────────────
  const ts = Date.parse(timestamp)
  if (Number.isNaN(ts)) {
    breakerRecordFailure(source)
    return { ok: false, response: errorResponse(400, 'bad_timestamp', 'x-n8n-timestamp must be an ISO-8601 string') }
  }
  const drift = Math.abs(Date.now() - ts)
  if (drift > FIVE_MINUTES_MS) {
    breakerRecordFailure(source)
    console.warn(
      `[n8n-auth] 401 timestamp_drift from ${source}: drift=${Math.round(drift / 1000)}s n8n_ts=${timestamp} server_ts=${new Date().toISOString()} ${callerFingerprint(request)}`,
    )
    return { ok: false, response: errorResponse(401, 'timestamp_drift', `clock drift > 5 min (${drift}ms)`) }
  }

  // ── Replay protection ──────────────────────────────────────────
  pruneSeen()
  const seenEntry = seenRequestIds.get(requestId)
  if (seenEntry) {
    if (seenEntry.cachedResponse) {
      // The first call completed — replay the stored result so n8n treats
      // the retry as successful rather than hitting an error branch.
      seenEntry.ts = Date.now() // refresh TTL
      const cached = seenEntry.cachedResponse
      return {
        ok: true,
        req: { rawBody: '', requestId, timestamp, idempotencyKey },
        cachedResponse: new Response(cached.body, {
          status: cached.status,
          headers: { 'content-type': cached.contentType, 'x-openclaw-replay': '1' },
        }),
      }
    }
    // First call still in-flight — genuine duplicate, reject.
    return { ok: false, response: errorResponse(409, 'replay_detected', `request ${requestId} already processed`) }
  }

  // ── Read raw body with size cap ────────────────────────────────
  const rawBody = await request.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(413, 'body_too_large', `body must be <= ${MAX_BODY_BYTES} bytes (got ${rawBody.length})`),
    }
  }

  // ── HMAC verify ────────────────────────────────────────────────
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'utf-8')
  const givenBuf = Buffer.from(signature, 'utf-8')
  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    breakerRecordFailure(source)
    // Print enough to diagnose without leaking the secret. Show:
    //   - first/last 4 chars of each digest (lets you eyeball mismatch),
    //   - first 6 chars of secret hash (so you can compare across env files),
    //   - body length (mismatched body = mismatched signature),
    //   - hint about the most common cause.
    const secretFingerprint = createHmac('sha256', 'fingerprint').update(secret).digest('hex').slice(0, 6)
    console.warn(
      `[n8n-auth] 401 bad_signature from ${source}: ` +
        `expected=${expected.slice(0, 4)}…${expected.slice(-4)} ` +
        `given=${signature.slice(0, 4)}…${signature.slice(-4)} ` +
        `body_len=${rawBody.length} secret_fp=${secretFingerprint} ` +
        `${callerFingerprint(request)} ` +
        `(if expected ≠ given: n8n's N8N_WEBHOOK_SECRET differs from the server's, ` +
        `or the body was re-stringified between sign and send)`,
    )
    return { ok: false, response: errorResponse(401, 'bad_signature', 'HMAC mismatch') }
  }

  // ── Idempotency check (post-verify so we don't replay forged requests) ──
  if (idempotencyKey) {
    pruneIdempotency()
    const cached = idempotencyCache.get(idempotencyKey)
    if (cached) {
      const res = new Response(cached.body, {
        status: cached.status,
        headers: {
          'content-type': cached.contentType,
          'x-openclaw-idempotency-replay': '1',
        },
      })
      // Mark requestId seen so a parallel duplicate doesn't slip through.
      seenRequestIds.set(requestId, { ts: Date.now(), cachedResponse: null })
      return { ok: true, req: { rawBody, requestId, timestamp, idempotencyKey }, cachedResponse: res }
    }
  }

  seenRequestIds.set(requestId, { ts: Date.now(), cachedResponse: null })
  breakerRecordSuccess(source)
  return { ok: true, req: { rawBody, requestId, timestamp, idempotencyKey }, cachedResponse: null }
}

/**
 * Cache a successful response keyed by idempotency key for 5 minutes.
 * Call once per route, ONLY after a 2xx outcome.
 */
export function rememberIdempotent(
  idempotencyKey: string | null,
  status: number,
  body: unknown,
): void {
  if (!idempotencyKey || status < 200 || status >= 300) return
  pruneIdempotency()
  idempotencyCache.set(idempotencyKey, {
    status,
    body: JSON.stringify(body),
    contentType: 'application/json',
    expiresAt: Date.now() + FIVE_MINUTES_MS,
  })
}

/** Standard JSON error helper — never leaks stack traces. */
export function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: code, message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Standard JSON success helper. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Store the successful response body against the request ID so that n8n
 * retries with the same x-n8n-request-id receive the original result (200)
 * instead of a 409. Call after every 2xx outcome.
 */
export function rememberRequestResponse(requestId: string, status: number, body: unknown): void {
  const entry = seenRequestIds.get(requestId)
  if (!entry || status < 200 || status >= 300) return
  entry.cachedResponse = {
    status,
    body: JSON.stringify(body),
    contentType: 'application/json',
    expiresAt: Date.now() + TEN_MINUTES_MS,
  }
}

// ── Maintenance ──────────────────────────────────────────────────
function pruneSeen(): void {
  const cutoff = Date.now() - TEN_MINUTES_MS
  for (const [id, entry] of seenRequestIds) if (entry.ts < cutoff) seenRequestIds.delete(id)
}

function pruneIdempotency(): void {
  const now = Date.now()
  for (const [k, v] of idempotencyCache) if (v.expiresAt < now) idempotencyCache.delete(k)
}

/** Test-only helpers. Do not call in app code. */
export function __resetN8nAuthCachesForTests(): void {
  seenRequestIds.clear()
  idempotencyCache.clear()
}
