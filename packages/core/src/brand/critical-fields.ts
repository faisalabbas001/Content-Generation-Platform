/**
 * The 10 generation-critical BrandDNA fields — single source of truth.
 *
 * Doc §6.2 + COO prompt §"The 10 critical fields" both reference these.
 * `completeness_score` is the percentage of these 10 that have a confidence
 * state of `inferred_medium` or higher.
 *
 * Why a constant:
 *   - Until now this list lived in two places: the COO prompt (markdown) and
 *     the Memory Controller whitelist (TS). They drifted apart. This file is
 *     the canonical list; both downstream consumers should reference it.
 *   - The SQL `recompute_completeness()` function (migration 0019) reads the
 *     same list of `evidence_bundles.field_name` values.
 *
 * If you add or remove a field here, update:
 *   1. prompts/OGzStudios_COO_Prompt_v1.md  — the natural-language list
 *   2. supabase/migrations/0019_recompute_completeness.sql — the SQL array
 *   3. packages/memory/src/types.ts — ALLOWED_FIELD_PATHS whitelist (if the
 *      field becomes user-correctable)
 */

/**
 * Stored as `evidence_bundles.field_name` — these are the names the Memory
 * Controller writes when persisting a field's confidence state.
 *
 * Note: prompt-side names use dotted paths like `VoiceProfile.arabic_dialect`,
 * but evidence_bundles.field_name uses the bare column name. The mapping is
 * intentional — evidence rows record the underlying SQL column being scored.
 */
export const CRITICAL_BRANDDNA_FIELDS = [
  // ── BrandDNA Lite — 10 original fields (Doc §6.2) ─────────────────
  'arabic_dialect',
  'brand_differentiator',
  'price_position',
  'primary_channel',
  'ramadan_relevance',
  'primary_audience_gender',
  'primary_kpi_type',
  'religious_sensitivity',
  'tone_anti_attribute_ids',
  'bilingual_ratio',
  // ── v2 axis additions (load-bearing per framework v2) ─────────────
  // archetype_secondary is NOT counted (optional, single-archetype brands
  // shouldn't be penalised). intent_state is NOT counted (most fluid
  // axis — legitimately shifts month-to-month even on well-known brands).
  'archetype_primary',
  'lifecycle_stage',
] as const

export type CriticalBrandDnaField = (typeof CRITICAL_BRANDDNA_FIELDS)[number]

/**
 * Confidence states that count as "the field is sufficiently confident
 * for the completeness score." Aligns with Doc §4.2 evidence states.
 */
// Must stay in sync with the ConfidenceState enum in packages/core/src/schemas/coo.ts
// and packages/memory/src/types.ts. Only states the COO actually emits are listed —
// 'evidence_weak' and 'evidence_strong' were removed because they don't exist in
// the DB field_confidence_type enum and are never emitted by any agent.
export const COMPLETENESS_QUALIFYING_STATES = [
  'inferred_medium',
  'inferred_high',
  'explicitly_confirmed',
] as const

export type CompletenessQualifyingState = (typeof COMPLETENESS_QUALIFYING_STATES)[number]

/**
 * Map a COO `field_path` (dotted prompt-side path) to its underlying critical
 * field name. Returns null if the path doesn't correspond to one of the 10.
 *
 * The COO prompt uses paths like `VoiceProfile.arabic_dialect`,
 * `BrandProfile.price_position`, `AudienceProfile.gender_mix`, etc. — but
 * `evidence_bundles.field_name` (and our SQL) uses bare names. This mapping
 * is the bridge.
 */
const FIELD_PATH_TO_NAME: Record<string, CriticalBrandDnaField> = {
  // Prompt-side dotted paths (the COO emits these)
  'VoiceProfile.arabic_dialect': 'arabic_dialect',
  'BrandProfile.brand_differentiator': 'brand_differentiator',
  'BrandProfile.price_position': 'price_position',
  'BrandProfile.primary_channel': 'primary_channel',
  'BrandProfile.ramadan_relevance': 'ramadan_relevance',
  'AudienceProfile.gender_mix': 'primary_audience_gender',
  'BrandProfile.primary_kpi_type': 'primary_kpi_type',
  'BrandProfile.religious_sensitivity': 'religious_sensitivity',
  'BrandProfile.tone_anti_attribute_ids': 'tone_anti_attribute_ids',
  'BrandProfile.bilingual_ratio': 'bilingual_ratio',
  // v2 axis fields
  'BrandProfile.archetype_primary': 'archetype_primary',
  'BrandProfile.lifecycle_stage': 'lifecycle_stage',
  // Bare names (in case a caller already uses field_name)
  arabic_dialect: 'arabic_dialect',
  brand_differentiator: 'brand_differentiator',
  price_position: 'price_position',
  primary_channel: 'primary_channel',
  ramadan_relevance: 'ramadan_relevance',
  primary_audience_gender: 'primary_audience_gender',
  primary_kpi_type: 'primary_kpi_type',
  religious_sensitivity: 'religious_sensitivity',
  tone_anti_attribute_ids: 'tone_anti_attribute_ids',
  bilingual_ratio: 'bilingual_ratio',
  archetype_primary: 'archetype_primary',
  lifecycle_stage: 'lifecycle_stage',
}

export function fieldPathToCriticalName(field_path: string): CriticalBrandDnaField | null {
  return FIELD_PATH_TO_NAME[field_path] ?? null
}

/**
 * Compute the completeness score from a set of (field_path, confidence_state)
 * pairs. Used by the COO call wrapper as a sanity check on the model's
 * self-reported number.
 *
 * Returns an integer 0–100.
 *
 * Field key flexibility: each entry can use either a dotted prompt-side path
 * (`VoiceProfile.arabic_dialect`) or the bare name (`arabic_dialect`) —
 * fieldPathToCriticalName handles both.
 */
export function computeCompletenessScore(
  states: Array<{ field_path?: string; field_name?: string; confidence_state: string }>,
): number {
  const qualified = new Set<CriticalBrandDnaField>()
  const qualifying = new Set<string>(COMPLETENESS_QUALIFYING_STATES)
  for (const s of states) {
    const key = s.field_path ?? s.field_name
    if (!key) continue
    const critical = fieldPathToCriticalName(key)
    if (critical && qualifying.has(s.confidence_state)) {
      qualified.add(critical)
    }
  }
  return Math.round((qualified.size / CRITICAL_BRANDDNA_FIELDS.length) * 100)
}
