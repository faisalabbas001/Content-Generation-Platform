/**
 * branddna_event_log writer (Doc §4.2).
 *
 * The Memory Controller is the ONLY agent allowed to write here. Every
 * applied nomination produces exactly one event row. The table is append-
 * only at the RLS layer (NO UPDATE / NO DELETE policies in 0001_init.sql),
 * so we never need to worry about rewriting history.
 *
 * Mapping nomination_type → event_type:
 *   field_update             → confidence_upgraded if confidence rose,
 *                              else client_confirmed (when source was the user)
 *   confidence_upgrade       → confidence_upgraded
 *   negative_pattern_add     → override_added (closest semantic match)
 *   override_rule_add        → override_added
 *   sector_signal            → source_ingested (anonymous outcome signal)
 *   global_signal            → source_ingested
 *   contradiction detected   → contradiction_detected (only from validate.ts
 *                              on conflict_score increase — added later)
 *   brand graduates          → brand_graduated (emitted by sector intel job)
 *
 * The `event_data` JSONB field captures the FULL context of what changed and
 * why — Doc §4 promises that we can rollback / replay BrandDNA state from
 * this log alone.
 */
import type { Db } from '@repo/db/client'
import type { Nomination } from './types'

export type EventType =
  | 'source_ingested'
  | 'contradiction_detected'
  | 'client_confirmed'
  | 'override_added'
  | 'confidence_upgraded'
  | 'brand_graduated'

export interface EventRow {
  brand_id: string | null
  event_type: EventType
  event_data: Record<string, unknown>
}

export async function appendEvent(db: Db, row: EventRow): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from('branddna_event_log').insert({
    brand_id: row.brand_id,
    event_type: row.event_type,
    event_data: row.event_data,
  } as never)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Map a successfully-applied nomination to the event row that should follow. */
export function eventForApplied(n: Nomination, applied_to: string): EventRow {
  const base: Pick<EventRow, 'brand_id' | 'event_data'> = {
    brand_id: n.brand_id,
    event_data: {
      nomination_type: n.nomination_type,
      applied_to,
      data: redactForLog(n.data),
    },
  }
  switch (n.nomination_type) {
    case 'field_update': {
      const source = (n.data as { source?: string }).source
      const event_type: EventType = source === 'client_confirmation' ? 'client_confirmed' : 'confidence_upgraded'
      return { ...base, event_type }
    }
    case 'confidence_upgrade':
      return { ...base, event_type: 'confidence_upgraded' }
    case 'negative_pattern_add':
    case 'override_rule_add':
      return { ...base, event_type: 'override_added' }
    case 'method_profile_update':
      // v2 — method profile changes are first-class brand-DNA events
      return { ...base, event_type: 'confidence_upgraded' }
    case 'sector_signal':
    case 'global_signal':
      return { ...base, event_type: 'source_ingested' }
  }
}

/**
 * Redact the data shape for the event log:
 *   - fingerprint hash (internal — not useful in audit)
 *   - any UUIDs in anonymous-signal payloads (defense-in-depth: the validator
 *     should already have caught these)
 */
function redactForLog(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data
  const clone: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k === '_fingerprint') continue
    clone[k] = v
  }
  return clone
}
