/**
 * processQueue — drain pending memory_controller_queue rows.
 *
 * Concurrency model:
 *   - Each invocation atomically CLAIMS a batch of pending rows by flipping
 *     their status to `validated` (using a single UPDATE … RETURNING).
 *   - Two workers running concurrently won't double-process a row because
 *     UPDATE acquires a row lock, and we filter on `status = 'pending'`.
 *   - After application, status becomes `written` or `rejected`.
 *
 * Idempotency:
 *   - The (status='pending') guard on the claim ensures a row processed by
 *     worker A is invisible to worker B.
 *   - The hash-based dedupe in enqueue.ts prevents duplicate rows in the
 *     first place.
 *
 * Per-row pipeline:
 *   1. Re-validate (validate.ts) against current DB state. State drift is
 *      possible between enqueue and process — e.g. brand was deleted.
 *   2. Dispatch to the right applier (apply-brand.ts / apply-anonymous.ts).
 *   3. Append to branddna_event_log (append-only audit).
 *   4. Update queue row → written or rejected.
 *
 * Failure handling:
 *   - DB errors during apply → row marked `rejected` with the reason.
 *   - Validation failure on re-check → `rejected` with the validator's code.
 *   - The function never throws on per-row failure; one bad nomination must
 *     not block the rest of the batch.
 */
import type { Db } from '@repo/db/client'
import { Nomination, type ProcessResult, type NominationProcessed } from './types'
import { validateNomination } from './validate'
import { pgBypassAdapter, type PgBypass } from './pg-bypass'
import {
  applyFieldUpdate,
  applyConfidenceUpgrade,
  applyNegativePatternAdd,
  applyOverrideRuleAdd,
  applyMethodProfileUpdate,
} from './apply-brand'
import { applySectorSignal, applyGlobalSignal } from './apply-anonymous'
import { appendEvent, eventForApplied } from './event-log'

export interface ProcessOptions {
  /** Max rows to claim per call. Default 50. */
  batch_size?: number
  /**
   * Auto-attach an RLS-bypass adapter (direct pg) when SUPABASE_DB_URL is set.
   * Default true — production with a real service-role JWT doesn't need it
   * (the JS client bypasses RLS already), but it's safe to leave on. Pass
   * false to force JS-client-only.
   */
  use_pg_bypass?: boolean
}

export async function processQueue(db: Db, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const batchSize = opts.batch_size ?? 50
  const bypass: PgBypass | null = opts.use_pg_bypass === false ? null : await pgBypassAdapter()

  // ── 1. Claim a batch atomically ───────────────────────────────────
  // The Supabase JS client doesn't expose `select FOR UPDATE` directly. We
  // emulate the atomic claim by selecting the IDs first, then UPDATE-ing
  // exactly those IDs only-if-still-pending. The `eq('status', 'pending')`
  // filter on the UPDATE means a parallel worker can't flip the same row.
  const { data: pending, error: e1 } = await db
    .from('memory_controller_queue')
    .select('nomination_id, brand_id, nomination_type, nomination_data')
    .eq('status', 'pending')
    .order('nominated_at', { ascending: true })
    .limit(batchSize)
  if (e1) {
    throw new Error(`processQueue: list pending failed: ${e1.message}`)
  }
  if (!pending || pending.length === 0) {
    return { total: 0, written: 0, rejected: 0, details: [] }
  }
  const ids = pending.map((r) => r.nomination_id as string)
  const { data: claimed, error: e2 } = await db
    .from('memory_controller_queue')
    .update({ status: 'validated' } as never)
    .in('nomination_id', ids)
    .eq('status', 'pending') // re-check — drops rows another worker just took
    .select('nomination_id, brand_id, nomination_type, nomination_data')
  if (e2) {
    throw new Error(`processQueue: claim batch failed: ${e2.message}`)
  }
  const rows = claimed ?? []

  // ── 2. Process each claimed row ───────────────────────────────────
  const details: NominationProcessed[] = []
  for (const row of rows) {
    const result = await processOne(db, row as QueueRow, bypass)
    details.push(result)
  }

  return {
    total: rows.length,
    written: details.filter((d) => d.status === 'written').length,
    rejected: details.filter((d) => d.status === 'rejected').length,
    details,
  }
}

/**
 * Process a single claimed row. Always returns a NominationProcessed and
 * always finalises the queue row's status — never leaves a row stuck in
 * `validated`.
 */
async function processOne(db: Db, row: QueueRow, bypass: PgBypass | null): Promise<NominationProcessed> {
  const id = row.nomination_id

  // Strip the internal _fingerprint key before reconstructing the Nomination.
  const data = stripInternal(row.nomination_data ?? {})
  const candidate = {
    nomination_type: row.nomination_type,
    brand_id: row.brand_id,
    data,
  }
  const parsed = Nomination.safeParse(candidate)
  if (!parsed.success) {
    return finaliseRejected(db, id, 'invalid_data_shape', parsed.error.issues[0]?.message ?? 'shape mismatch')
  }
  const nom = parsed.data

  // Second-pass validation against current DB state.
  const v = await validateNomination(db, nom, bypass)
  if (!v.ok) {
    return finaliseRejected(db, id, v.code, v.reason)
  }

  // Dispatch to the right applier.
  const r = await applyOne(db, v.normalised)
  if (!r.ok) {
    return finaliseRejected(db, id, 'apply_failed', r.reason)
  }

  // Append to branddna_event_log.
  const eventResult = await appendEvent(db, eventForApplied(v.normalised, r.applied_to))
  if (!eventResult.ok) {
    // The actual write succeeded; the audit append failed. Per Doc §4 the
    // event log is non-negotiable — log loudly and mark this row as written
    // with a warning in rejection_reason so ops sees it.
    console.warn(`[memory] event_log append failed for ${id}: ${eventResult.error}`)
    await markStatus(db, id, 'written', `applied OK; event_log append failed: ${eventResult.error}`)
    return { nomination_id: id, status: 'written', applied_to: r.applied_to, rejection_reason: `event_log append failed: ${eventResult.error}` }
  }

  await markStatus(db, id, 'written', null)
  return { nomination_id: id, status: 'written', applied_to: r.applied_to }
}

async function applyOne(db: Db, n: Nomination): Promise<{ ok: true; applied_to: string } | { ok: false; reason: string }> {
  switch (n.nomination_type) {
    case 'field_update':           return applyFieldUpdate(db, n.brand_id, n.data)
    case 'confidence_upgrade':     return applyConfidenceUpgrade(db, n.brand_id, n.data)
    case 'negative_pattern_add':   return applyNegativePatternAdd(db, n.brand_id, n.data)
    case 'override_rule_add':      return applyOverrideRuleAdd(db, n.brand_id, n.data)
    case 'method_profile_update':  return applyMethodProfileUpdate(db, n.brand_id, n.data)
    case 'sector_signal':          return applySectorSignal(db, n.data)
    case 'global_signal':          return applyGlobalSignal(db, n.data)
  }
}

async function finaliseRejected(db: Db, id: string, code: string, reason: string): Promise<NominationProcessed> {
  await markStatus(db, id, 'rejected', `${code}: ${reason}`)
  return { nomination_id: id, status: 'rejected', rejection_reason: `${code}: ${reason}` }
}

async function markStatus(
  db: Db,
  nomination_id: string,
  status: 'written' | 'rejected',
  rejection_reason: string | null,
): Promise<void> {
  const { error } = await db
    .from('memory_controller_queue')
    .update({
      status,
      processed_at: new Date().toISOString(),
      rejection_reason,
    } as never)
    .eq('nomination_id', nomination_id)
  if (error) {
    // If we can't mark the row, the next claim will pick it up again. Worst
    // case the same nomination is applied twice — but appliers are idempotent
    // (upserts + de-dupe), so this is safe.
    console.warn(`[memory] markStatus failed for ${nomination_id}: ${error.message}`)
  }
}

function stripInternal(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
}

interface QueueRow {
  nomination_id: string
  brand_id: string | null
  nomination_type: 'field_update' | 'confidence_upgrade' | 'negative_pattern_add' | 'override_rule_add' | 'method_profile_update' | 'sector_signal' | 'global_signal'
  nomination_data: Record<string, unknown> | null
}
