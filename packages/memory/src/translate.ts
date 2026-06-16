/**
 * Translate CEO-prompt-shape `memory_nominations[]` into Memory Controller
 * `Nomination[]`.
 *
 * The CEO prompt (prompts/OGzStudios_CEO_Prompt_v1.md §"Step 8") defines a
 * different set of nomination_type values than the DB enum:
 *
 *   CEO prompt → DB enum
 *   ──────────────────────────────────────────────
 *   field_update     → field_update     (when source !== "system_inference")
 *                    → confidence_upgrade (when confidence_delta is set)
 *   decision_trace   → DROPPED — this is a routing audit, already covered
 *                      by routing_decisions row written by the AI wrapper.
 *   event_log        → DROPPED — branddna_event_log is written by the
 *                      Memory Controller after each apply, not by CEO direct.
 *   conflict_flag    → DROPPED — Phase 2 work; not yet acted on.
 *
 * Anything we can't map cleanly is reported in `dropped[]` so callers can
 * audit drift between the prompt and the schema.
 */
import type { Nomination } from './types'

interface CeoPromptNomination {
  nomination_type?: string
  family?: string
  field_path?: string
  proposed_value?: unknown
  source?: string
  // CEO prompt v1 emits a string like "upgrade_to_inferred_high".
  // CEO prompt v2 may emit an object like { from: "premium", to: "mid_market" }.
  confidence_delta?: string | Record<string, unknown> | null
  human_review_required?: boolean
  // Some CEO outputs may carry extra fields — we tolerate them.
  [k: string]: unknown
}

export interface TranslateResult {
  nominations: Nomination[]
  dropped: Array<{ index: number; reason: string; original: CeoPromptNomination }>
}

const SUPPORTED_SOURCES = new Set(['client_confirmation', 'cco_qc', 'deepseek_output', 'system_inference', 'client_correction_form', 'client_confirmation_pending'])

/**
 * Translate a CEO output array. The function does NOT validate field_path
 * etc. — that's validate.ts's job (run during processing). Here we only
 * normalise the shape so the discriminated union accepts the input.
 *
 * `brand_id` is supplied by the caller because CEO output doesn't echo it
 * back — the route knows which brand the call was for.
 */
export function translateCeoNominations(
  brand_id: string | null,
  raw: unknown,
): TranslateResult {
  const out: TranslateResult = { nominations: [], dropped: [] }
  if (!Array.isArray(raw)) return out

  for (let i = 0; i < raw.length; i++) {
    const item = (raw[i] ?? {}) as CeoPromptNomination
    const t = item.nomination_type
    if (!t) {
      out.dropped.push({ index: i, reason: 'missing nomination_type', original: item })
      continue
    }

    // Drop CEO-only audit types that the Memory Controller doesn't apply.
    if (t === 'decision_trace' || t === 'event_log' || t === 'conflict_flag') {
      out.dropped.push({ index: i, reason: `dropped CEO-only type "${t}"`, original: item })
      continue
    }

    // Drop field_update nominations targeting virtual/non-DB namespaces.
    // BrandMethodProfile = COO recomposition hint (no DB table — CEO uses it as
    // a signal that COO Pass 3 is needed; Memory Controller cannot act on it).
    // evidence_bundles.* = confidence state, handled via confidence_upgrade type.
    if (t === 'field_update') {
      const fp = item.field_path ?? ''
      if (
        fp === 'BrandMethodProfile' ||
        fp.startsWith('BrandMethodProfile.') ||
        fp.startsWith('evidence_bundles.')
      ) {
        out.dropped.push({ index: i, reason: `dropped virtual namespace "${fp}" — no DB target`, original: item })
        continue
      }
    }

    // method_profile_update (CEO prompt v2) → treat as field_update for DB.
    // It updates identity-family fields (archetype, lifecycle, intent_state, etc.)
    if (t === 'method_profile_update') {
      if (!brand_id) {
        out.dropped.push({ index: i, reason: 'method_profile_update requires brand_id', original: item })
        continue
      }
      const source = SUPPORTED_SOURCES.has(item.source ?? '') ? (item.source as 'client_confirmation' | 'cco_qc' | 'deepseek_output' | 'system_inference' | 'client_correction_form' | 'client_confirmation_pending') : 'system_inference'
      // CEO v2 may send proposed_value as a delta object { to, from, field, ... } — extract scalar.
      let mpProposedValue = item.proposed_value
      if (mpProposedValue !== null && typeof mpProposedValue === 'object' && !Array.isArray(mpProposedValue) && 'to' in (mpProposedValue as Record<string, unknown>)) {
        mpProposedValue = (mpProposedValue as Record<string, unknown>).to
      }
      out.nominations.push({
        nomination_type: 'field_update',
        brand_id,
        data: {
          field_path: item.field_path ?? '',
          proposed_value: mpProposedValue,
          source: (source === 'client_correction_form' || source === 'client_confirmation_pending') ? 'client_confirmation' : (source as 'client_confirmation' | 'cco_qc' | 'deepseek_output' | 'system_inference'),
        },
      })
      continue
    }

    if (t === 'field_update') {
      // Two cases:
      //   (a) confidence-only string delta (v1 prompt) → confidence_upgrade
      //   (b) value update — proposed_value is present OR delta is an object with a "to" key (v2 prompt)
      const isStringDelta = typeof item.confidence_delta === 'string' && item.confidence_delta.length > 0
      const isConfidenceUpgrade = isStringDelta && item.proposed_value === undefined

      if (isConfidenceUpgrade) {
        if (!brand_id) {
          out.dropped.push({ index: i, reason: 'confidence_upgrade requires brand_id', original: item })
          continue
        }
        const newState = parseConfidenceDelta(item.confidence_delta as string)
        if (!newState) {
          out.dropped.push({ index: i, reason: `unparsable confidence_delta "${item.confidence_delta}"`, original: item })
          continue
        }
        out.nominations.push({
          nomination_type: 'confidence_upgrade',
          brand_id,
          data: {
            field_name: item.field_path ?? 'unknown',
            new_state: newState,
            evidence_source_ids: [],
          },
        })
        continue
      }

      if (!brand_id) {
        out.dropped.push({ index: i, reason: 'field_update requires brand_id', original: item })
        continue
      }

      // CEO v2 may emit confidence_delta as { from: "old", to: "new" } with no proposed_value.
      // Extract proposed_value from the delta object in that case.
      let proposedValue = item.proposed_value
      if (proposedValue === undefined && item.confidence_delta && typeof item.confidence_delta === 'object') {
        proposedValue = (item.confidence_delta as Record<string, unknown>).to
      }
      // CEO v2 may also emit proposed_value itself as a delta object { to, from, field, ... }.
      // Extract the scalar .to value in that case.
      if (proposedValue !== null && typeof proposedValue === 'object' && !Array.isArray(proposedValue) && 'to' in (proposedValue as Record<string, unknown>)) {
        proposedValue = (proposedValue as Record<string, unknown>).to
      }

      if (proposedValue === undefined) {
        out.dropped.push({ index: i, reason: 'field_update has no proposed_value and no extractable delta', original: item })
        continue
      }

      const rawSource = SUPPORTED_SOURCES.has(item.source ?? '') ? item.source : 'system_inference'
      // client_correction_form / client_confirmation_pending are CEO v2 aliases — normalize to client_confirmation.
      const source = (rawSource === 'client_correction_form' || rawSource === 'client_confirmation_pending') ? 'client_confirmation' : rawSource as 'client_confirmation' | 'cco_qc' | 'deepseek_output' | 'system_inference'
      out.nominations.push({
        nomination_type: 'field_update',
        brand_id,
        data: {
          field_path: item.field_path ?? '',
          proposed_value: proposedValue,
          source,
        },
      })
      continue
    }

    // The DB-enum types pass through (CEO prompt could be extended later
    // to emit them directly — accept them now for forward compatibility).
    if (t === 'confidence_upgrade' || t === 'field_update' || t === 'negative_pattern_add' || t === 'override_rule_add' || t === 'sector_signal' || t === 'global_signal') {
      // Already a DB-enum shape — pass through unchanged. Validation happens
      // at enqueue.ts via the Zod discriminated union.
      out.nominations.push(item as unknown as Nomination)
      continue
    }

    out.dropped.push({ index: i, reason: `unknown nomination_type "${t}"`, original: item })
  }

  return out
}

/**
 * Parse strings like:
 *   "upgrade_to_inferred_high"        → "inferred_high"
 *   "upgrade_to_explicitly_confirmed" → "explicitly_confirmed"
 *   "rejected"                        → "rejected"
 * Returns null if the string can't be mapped.
 */
function parseConfidenceDelta(s: string): null | 'explicitly_confirmed' | 'inferred_high' | 'inferred_medium' | 'inferred_low' | 'rejected' | 'deprecated' {
  const norm = s.toLowerCase().replace(/^upgrade_to_/, '').replace(/^downgrade_to_/, '')
  const allowed = ['explicitly_confirmed', 'inferred_high', 'inferred_medium', 'inferred_low', 'rejected', 'deprecated'] as const
  for (const v of allowed) if (norm === v) return v
  return null
}
