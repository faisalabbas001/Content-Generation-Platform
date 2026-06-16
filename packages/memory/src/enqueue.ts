/**
 * Enqueue — write nominations to memory_controller_queue as `pending`.
 *
 * Called from the CEO classify route (after every CEO call) and from server
 * actions like /onboarding-start (after COO build_branddna). The function is
 * idempotent on `(nomination_type, brand_id, deterministic-data-hash)` so
 * retried CEO calls don't duplicate nominations.
 *
 * IMPORTANT: this function NEVER applies a nomination — it only queues it.
 * Application happens in `process()` (which has its own RLS-bypass service-
 * role client). Separating "nominate" from "apply" is the single most
 * important Hard Rule (Doc §1.4 Rule #2).
 */
import { createHash } from 'node:crypto'
import type { Db } from '@repo/db/client'
import { Nomination, type ProcessResult } from './types'

export interface EnqueueOptions {
  /**
   * Which agent / system created these nominations. Stored on the queue row
   * for audit. Default 'CEO' since that's the spec's expected source.
   */
  nominated_by?: string
}

export interface EnqueueResult {
  enqueued: number
  skipped_duplicates: number
  rejected_at_input: number
  /** Per-nomination status — useful for the CEO route to log back. */
  details: Array<
    | { ok: true; nomination_id: string; duplicate: boolean }
    | { ok: false; error: string; index: number }
  >
}

/**
 * Insert one or more nominations. Each nomination is validated against the
 * discriminated union BEFORE touching the DB; invalid items are reported in
 * `details` but don't block the rest of the batch.
 *
 * Idempotency: we compute a SHA-256 over (nomination_type, brand_id, sorted
 * JSON of data) and look up existing rows by the corresponding payload hash
 * stored under `nomination_data._fingerprint`. This survives n8n retries
 * inside the 5-minute idempotency window already enforced at the route layer
 * AND across longer time windows (CEO can re-emit the same nomination on a
 * second classify call without doubling the write).
 */
export async function enqueueNominations(
  db: Db,
  rawNominations: unknown[],
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const result: EnqueueResult = { enqueued: 0, skipped_duplicates: 0, rejected_at_input: 0, details: [] }

  for (let i = 0; i < rawNominations.length; i++) {
    const parsed = Nomination.safeParse(rawNominations[i])
    if (!parsed.success) {
      result.rejected_at_input++
      result.details.push({
        ok: false,
        index: i,
        error: parsed.error.issues
          .slice(0, 3)
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; '),
      })
      continue
    }
    const nom = parsed.data
    const fingerprint = computeFingerprint(nom)

    // Idempotency probe — only skip if there is a PENDING (not yet processed)
    // nomination with the same fingerprint. Completed/applied rows must NOT
    // block re-submission: the user may intentionally re-save the same value
    // (e.g. page refresh then save again) and we must not silently discard it.
    const { data: existing } = await db
      .from('memory_controller_queue')
      .select('nomination_id')
      .eq('nomination_type', nom.nomination_type)
      .eq('status' as never, 'pending')
      .filter('nomination_data->>_fingerprint', 'eq', fingerprint)
      .limit(1)

    if (existing && existing.length > 0) {
      result.skipped_duplicates++
      result.details.push({ ok: true, nomination_id: existing[0]!.nomination_id as string, duplicate: true })
      continue
    }

    const { data: inserted, error } = await db
      .from('memory_controller_queue')
      .insert({
        brand_id: nom.brand_id,
        nomination_type: nom.nomination_type,
        nomination_data: { ...nom.data, _fingerprint: fingerprint },
        nominated_by: opts.nominated_by ?? 'CEO',
        status: 'pending',
      } as never)
      .select('nomination_id')
      .single()

    if (error || !inserted) {
      result.rejected_at_input++
      result.details.push({ ok: false, index: i, error: error?.message ?? 'insert failed' })
      continue
    }

    result.enqueued++
    result.details.push({ ok: true, nomination_id: (inserted as { nomination_id: string }).nomination_id, duplicate: false })
  }

  return result
}

/**
 * Stable fingerprint over the meaningful parts of a nomination. Used as the
 * idempotency key — sorted-keys JSON ensures (data: {a:1,b:2}) and
 * (data: {b:2,a:1}) hash identically.
 */
function computeFingerprint(n: Nomination): string {
  const canonical = JSON.stringify({
    type: n.nomination_type,
    brand: n.brand_id,
    data: sortKeys(n.data as Record<string, unknown>),
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

function sortKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortKeys)
  if (input && typeof input === 'object') {
    const keys = Object.keys(input as Record<string, unknown>).sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = sortKeys((input as Record<string, unknown>)[k])
    return out
  }
  return input
}

/** Convenience aggregate — useful for callers that expect the same shape as process(). */
export function summarize(enqueueResult: EnqueueResult): ProcessResult {
  return {
    total: enqueueResult.enqueued + enqueueResult.skipped_duplicates + enqueueResult.rejected_at_input,
    written: 0, // enqueue doesn't apply
    rejected: enqueueResult.rejected_at_input,
    details: [],
  }
}
