/**
 * Retry + observability harness for every AI call.
 *
 * Implements the Doc §5.4 pattern:
 *   TRY → success → done
 *        ↓ fail
 *      wait 2s → RETRY 1 → success → done
 *                        ↓ fail
 *                      wait 4s → RETRY 2 → success → done
 *                                        ↓ fail
 *                                      → write anomaly_records + usage_logs
 *                                      → throw AiCallFailedError (caller skips this client/post)
 *
 * Every call (success or failure) writes one row to `usage_logs` so the Cost
 * Monitor and §10.3 alerting see the cost in real time. Final failures also
 * write an `anomaly_records` row; the caller is responsible for triggering
 * N8N-S03 (anomaly router) — we don't fan out webhooks from inside a wrapper.
 */
import type { Db } from '@repo/db/client'

export interface UsageLogRow {
  flow_id:     string
  brand_id:    string | null
  node_name:   string
  // ── Populated since migration 0074 ───────────────────────────────────────
  agent?:      string | null   // 'CEO' | 'COO' | 'CCO' | 'DeepSeek' | etc.
  provider?:   string | null   // 'anthropic' | 'openai' | 'deepseek' | 'fal' | 'apify' | 'google'
  model?:      string | null   // exact model string from provider response
  request_type?: string | null // 'ai_cost' | 'image_cost' | 'video_cost' | 'scrape_cost' | 'audit'
  status?:     'success' | 'error' | null
  error_code?: string | null
  flow_run_id?:  string | null
  client_slug?:  string | null
  tokens_in?:    number | null
  tokens_out?:   number | null
  tokens_cached?: number | null
  cost_usd_input?:  number | null
  cost_usd_output?: number | null
  cost_usd_cached?: number | null
  images_generated?: number | null
  monthly_ceiling_usd?: number | null
  // ── Core fields (always populated) ───────────────────────────────────────
  duration_ms: number
  cost_usd:    number
  payload?:    Record<string, unknown> | null
}

export interface AnomalyRow {
  brand_id: string | null
  anomaly_type: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  details: Record<string, unknown>
}

export interface RetryContext {
  flow_id:    string
  brand_id:   string | null
  node_name:  'ceo' | 'coo' | 'cco' | 'deepseek' | 'visual_prompt' | 'copilot_management' | 'copilot_tech' | 'copilot_production' | 'extraction_prefill'
  db:         Db | null
  // ── Extra context stamped from n8n request headers ────────────────────────
  flow_run_id?:  string | null  // x-n8n-execution-id
  client_slug?:  string | null  // x-client-slug
  maxRetries?:   number
  baseBackoffMs?: number
}

export class AiCallFailedError extends Error {
  constructor(
    message: string,
    public readonly node: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
    public readonly isOverloaded: boolean = false,
  ) {
    super(message)
    this.name = 'AiCallFailedError'
  }
}

/** What an fn() inside withRetryAndLogging must return. */
export interface AiCallResult<T> {
  result:    T
  cost_usd:  number
  // ── New: full cost breakdown + token counts ───────────────────────────────
  agent?:        string
  provider?:     string
  model?:        string
  tokens_in?:    number
  tokens_out?:   number
  tokens_cached?: number
  cost_usd_input?:  number
  cost_usd_output?: number
  cost_usd_cached?: number
  payload?:      Record<string, unknown>
}

/**
 * Wrap an async AI call with retry + usage logging. Returns the raw result.
 * Validation (Zod) happens in the caller — but a Zod parse failure thrown
 * inside `fn` counts as one attempt and triggers the standard retry chain.
 */
export async function withRetryAndLogging<T>(
  ctx: RetryContext,
  fn: () => Promise<AiCallResult<T>>,
): Promise<T> {
  const max  = ctx.maxRetries ?? 2
  const base = ctx.baseBackoffMs ?? 2000
  let lastError: unknown = null

  for (let attempt = 0; attempt <= max; attempt++) {
    const start = Date.now()
    try {
      const res = await fn()
      // Fire-and-forget — logging is observability-only; never block the caller
      void safeWriteUsageLog(ctx.db, {
        flow_id:   ctx.flow_id,
        brand_id:  ctx.brand_id,
        node_name: ctx.node_name,
        agent:     res.agent    ?? nodeToAgent(ctx.node_name),
        provider:  res.provider ?? nodeToProvider(ctx.node_name),
        model:     res.model    ?? null,
        request_type:  'ai_cost',
        status:        'success',
        flow_run_id:   ctx.flow_run_id ?? null,
        client_slug:   ctx.client_slug ?? null,
        tokens_in:     res.tokens_in     ?? null,
        tokens_out:    res.tokens_out    ?? null,
        tokens_cached: res.tokens_cached ?? null,
        cost_usd_input:  res.cost_usd_input  ?? null,
        cost_usd_output: res.cost_usd_output ?? null,
        cost_usd_cached: res.cost_usd_cached ?? null,
        duration_ms: Date.now() - start,
        cost_usd:    res.cost_usd,
        payload: { attempt, ...(res.payload ?? {}) },
      })
      return res.result
    } catch (err) {
      lastError = err
      const duration = Date.now() - start
      console.error(`[retry] ${ctx.node_name} attempt ${attempt + 1}/${max + 1} failed (${duration}ms):`, serializeError(err))
      await safeWriteUsageLog(ctx.db, {
        flow_id:   ctx.flow_id,
        brand_id:  ctx.brand_id,
        node_name: ctx.node_name,
        agent:     nodeToAgent(ctx.node_name),
        provider:  nodeToProvider(ctx.node_name),
        request_type: 'ai_cost',
        status:       'error',
        error_code:   extractErrorCode(err),
        flow_run_id:  ctx.flow_run_id ?? null,
        client_slug:  ctx.client_slug ?? null,
        duration_ms:  duration,
        cost_usd:     0,
        payload: { attempt, error: serializeError(err), failed: true },
      })
      if (attempt < max) {
        const isOverloaded = isProviderOverloaded(err)
        const backoff = isOverloaded ? 5000 * (attempt + 1) : base * Math.pow(2, attempt)
        if (isOverloaded) {
          console.warn(`[retry] ${ctx.node_name} provider overloaded/rate-limited — backing off ${backoff}ms`)
        }
        await sleep(backoff)
        continue
      }
      const overloaded = isProviderOverloaded(err)
      await safeWriteAnomaly(ctx.db, {
        brand_id:     ctx.brand_id,
        anomaly_type: `${ctx.node_name}_call_failed`,
        severity:     'error',
        details: { flow_id: ctx.flow_id, attempts: attempt + 1, error: serializeError(err), overloaded },
      })
      throw new AiCallFailedError(
        `${ctx.node_name} call failed after ${attempt + 1} attempt(s)`,
        ctx.node_name,
        attempt + 1,
        err,
        overloaded,
      )
    }
  }
  throw new AiCallFailedError(`${ctx.node_name} retry loop exited unexpectedly`, ctx.node_name, max + 1, lastError)
}

// ── Direct write — for non-AI costs (image/video/scrape/audit) ────────────────

/**
 * Write a single usage_logs row directly (no retry logic).
 * Use this for FAL image generation, Apify scrapes, Google Places calls
 * and audit events (QA approve/reject) where there is no AI retry loop.
 */
export async function writeUsageLog(db: Db | null, row: UsageLogRow): Promise<void> {
  await safeWriteUsageLog(db, row)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nodeToAgent(node: string): string {
  const map: Record<string, string> = {
    ceo:                  'CEO',
    coo:                  'COO',
    cco:                  'CCO',
    deepseek:             'DeepSeek',
    extraction_prefill:   'ExtractionPrefill',
    copilot_management:   'CopilotManagement',
    copilot_tech:         'CopilotTech',
    copilot_production:   'CopilotProduction',
  }
  return map[node] ?? node
}

function nodeToProvider(node: string): string {
  const map: Record<string, string> = {
    ceo:                'openai',
    coo:                'openai',
    extraction_prefill: 'anthropic',
    copilot_management: 'anthropic',
    copilot_tech:       'anthropic',
    copilot_production: 'anthropic',
    cco:                'openai',
    deepseek:           'deepseek',
  }
  return map[node] ?? 'unknown'
}

function extractErrorCode(err: unknown): string | null {
  if (err == null || typeof err !== 'object') return String(err).slice(0, 64)
  const e = err as Record<string, unknown>
  if (typeof e['status'] === 'number') return `HTTP_${e['status']}`
  if (typeof e['code'] === 'string') return e['code'].slice(0, 64)
  if (typeof e['message'] === 'string') return e['message'].slice(0, 64)
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isProviderOverloaded(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  const status = typeof e['status'] === 'number' ? e['status'] : null
  // Anthropic 529 = overloaded; OpenAI 429 = rate-limited — both warrant a longer backoff.
  if (status === 529 || status === 429) return true
  if (typeof e['message'] === 'string') {
    const msg = e['message'].toLowerCase()
    if (msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('too many requests')) return true
  }
  return false
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 6).join('\n') }
  }
  // Non-Error objects (e.g. OpenAI SDK APIError, DOMException) — extract every
  // readable property so the log is never an empty {}.
  if (err !== null && typeof err === 'object') {
    const o = err as Record<string, unknown>
    return {
      constructor: (err as object).constructor?.name ?? 'unknown',
      message:     String(o['message'] ?? o['msg'] ?? ''),
      status:      o['status'] ?? o['statusCode'] ?? '',
      code:        o['code'] ?? o['error'] ?? '',
      raw:         (() => { try { return JSON.stringify(err).slice(0, 400) } catch { return String(err) } })(),
    }
  }
  return { value: String(err) }
}

async function safeWriteUsageLog(db: Db | null, row: UsageLogRow): Promise<void> {
  if (!db) return
  try {
    const { error } = await db.from('usage_logs').insert({
      flow_id:      row.flow_id,
      brand_id:     row.brand_id,
      node_name:    row.node_name,
      agent:        row.agent        ?? null,
      provider:     row.provider     ?? null,
      model:        row.model        ?? null,
      request_type: row.request_type ?? null,
      status:       row.status       ?? null,
      error_code:   row.error_code   ?? null,
      flow_run_id:  row.flow_run_id  ?? null,
      client_slug:  row.client_slug  ?? null,
      tokens_in:    row.tokens_in    ?? null,
      tokens_out:   row.tokens_out   ?? null,
      tokens_cached: row.tokens_cached ?? null,
      cost_usd_input:  row.cost_usd_input  ?? null,
      cost_usd_output: row.cost_usd_output ?? null,
      cost_usd_cached: row.cost_usd_cached ?? null,
      images_generated:    row.images_generated    ?? null,
      monthly_ceiling_usd: row.monthly_ceiling_usd ?? null,
      duration_ms: row.duration_ms,
      cost_usd:    row.cost_usd,
      payload:     row.payload ?? {},
    } as never)
    if (error && process.env.AI_DEBUG_LOGGING) {
      console.warn('[retry] usage_logs insert failed:', error.message)
    }
  } catch {
    // Never let logging break a production call.
  }
}

async function safeWriteAnomaly(db: Db | null, row: AnomalyRow): Promise<void> {
  if (!db) return
  try {
    const { error } = await db.from('anomaly_records').insert({
      brand_id:     row.brand_id,
      anomaly_type: row.anomaly_type,
      severity:     row.severity,
      details:      row.details,
    } as never)
    if (error && process.env.AI_DEBUG_LOGGING) {
      console.warn('[retry] anomaly_records insert failed:', error.message)
    }
  } catch {
    // Same — never throw from observability.
  }
}
