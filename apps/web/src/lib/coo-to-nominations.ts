/**
 * Convert a COO `build_branddna` response into the discriminated-union
 * nominations that the Memory Controller consumes.
 *
 * Why this lives in apps/web (not packages/memory):
 *   - It's a route-layer concern (the COO route is the only caller).
 *   - packages/memory is the WRITER — keeping the COO→Memory adapter outside
 *     preserves the package boundary (memory has no idea what COO is).
 *
 * What it produces, per COO field_nomination:
 *   1. A `field_update` nomination — when the field maps to a writable column
 *      AND the confidence is `inferred_medium` or better. Without this, the
 *      10 critical fields never land on brand_profiles.
 *   2. A `confidence_upgrade` nomination — for EVERY nomination. This is what
 *      seeds evidence_bundles so `recompute_completeness()` has rows to count.
 *
 * Plus the three v2 axis fields (archetype_primary, archetype_secondary,
 * lifecycle_stage) — COO returns these via `axis_inference`, not
 * `field_nominations`, so we synthesize the nominations here.
 */
import type { schemas } from '@repo/core'

type BuildBrandDnaResponse = schemas.BuildBrandDnaResponse

// COO's ConfidenceState → Memory's ConfidenceState. COO emits `missing` for
// fields with no evidence; Memory has no such state — we map it to `rejected`
// (= the field was nominated but the value is not trustworthy).
const COO_TO_MEMORY_CONFIDENCE: Record<string, string> = {
  explicitly_confirmed: 'explicitly_confirmed',
  inferred_high:        'inferred_high',
  inferred_medium:      'inferred_medium',
  inferred_low:         'inferred_low',
  missing:              'rejected',
}

// Which COO confidence states should drive a real column write. Anything
// below `inferred_medium` is too weak to overwrite a column — but we still
// nominate a `confidence_upgrade` so the evidence_bundles row exists.
const WRITEABLE_STATES = new Set(['explicitly_confirmed', 'inferred_high', 'inferred_medium'])

// COO sometimes emits the prompt-side path, sometimes the bare evidence
// name. Normalise to the form Memory's whitelist recognises.
const FIELD_PATH_REMAP: Record<string, string> = {
  // The COO prompt's "VoiceProfile.*" path is already on the whitelist via
  // the alias entry; the remap exists to forgive any drift in either
  // direction.
  'VoiceProfile.arabic_dialect': 'VoiceProfile.arabic_dialect',
  arabic_dialect:                'VoiceProfile.arabic_dialect',
  brand_differentiator:          'BrandProfile.brand_differentiator',
  price_position:                'BrandProfile.price_position',
  primary_channel:               'BrandProfile.primary_channel',
  ramadan_relevance:             'BrandProfile.ramadan_relevance',
  primary_audience_gender:       'AudienceProfile.gender_mix',
  primary_kpi_type:              'BrandProfile.primary_kpi_type',
  religious_sensitivity:         'BrandProfile.religious_sensitivity',
  tone_anti_attribute_ids:       'BrandProfile.tone_anti_attribute_ids',
  bilingual_ratio:               'BrandProfile.bilingual_ratio',
  archetype_primary:             'BrandProfile.archetype_primary',
  lifecycle_stage:               'BrandProfile.lifecycle_stage',
  // AudienceProfile.* drifts that should route to BrandProfile.* — we add
  // entries on the whitelist with audience_profiles → brand_profiles routing,
  // but ALSO remap the path here so the field_update reaches the right column.
  'AudienceProfile.bilingual_ratio':  'BrandProfile.bilingual_ratio',
  'AudienceProfile.primary_kpi_type': 'BrandProfile.primary_kpi_type',
  // Instagram analytics fields (migration 0094) — bare names from COO
  followers_count:            'BrandProfile.followers_count',
  ig_post_count:              'BrandProfile.ig_post_count',
  ig_verified:                'BrandProfile.ig_verified',
  account_type:               'BrandProfile.account_type',
  bio_text:                   'BrandProfile.bio_text',
  avg_engagement_rate:        'BrandProfile.avg_engagement_rate',
  posting_frequency_per_week: 'BrandProfile.posting_frequency_per_week',
  primary_content_format:     'BrandProfile.primary_content_format',
  content_type_distribution:  'BrandProfile.content_type_distribution',
  caption_avg_length:         'BrandProfile.caption_avg_length',
  top_hashtags:               'BrandProfile.top_hashtags',
  top_mentioned_accounts:     'BrandProfile.top_mentioned_accounts',
  audience_location_primary:  'AudienceProfile.audience_location_primary',
  follower_quality_signal:    'AudienceProfile.follower_quality_signal',
  aspect_ratio_primary:       'VisualStyleProfile.aspect_ratio_primary',
  filter_style:               'VisualStyleProfile.filter_style',
  has_arabic_overlay:         'VisualStyleProfile.has_arabic_overlay',
}

// `evidence_bundles.field_name` is the bare column name (Doc §4.2).
// Cover BOTH BrandProfile.* and VoiceProfile.* prefixes so COO's drifting
// field paths all resolve to the same evidence row.
const FIELD_PATH_TO_EVIDENCE_NAME: Record<string, string> = {
  // arabic_dialect (already aliased on whitelist side too)
  'VoiceProfile.arabic_dialect':        'arabic_dialect',
  'BrandProfile.arabic_dialect':        'arabic_dialect',
  // Critical fields — both prefixes
  'BrandProfile.brand_differentiator':  'brand_differentiator',
  'VoiceProfile.brand_differentiator':  'brand_differentiator',
  'BrandProfile.price_position':        'price_position',
  'VoiceProfile.price_position':        'price_position',
  'BrandProfile.primary_channel':       'primary_channel',
  'VoiceProfile.primary_channel':       'primary_channel',
  'BrandProfile.ramadan_relevance':     'ramadan_relevance',
  'VoiceProfile.ramadan_relevance':     'ramadan_relevance',
  'BrandProfile.religious_sensitivity': 'religious_sensitivity',
  'VoiceProfile.religious_sensitivity': 'religious_sensitivity',
  'BrandProfile.tone_anti_attribute_ids': 'tone_anti_attribute_ids',
  'VoiceProfile.tone_anti_attribute_ids': 'tone_anti_attribute_ids',
  'BrandProfile.bilingual_ratio':       'bilingual_ratio',
  'VoiceProfile.bilingual_ratio':       'bilingual_ratio',
  'BrandProfile.primary_kpi_type':      'primary_kpi_type',
  'VoiceProfile.primary_kpi_type':      'primary_kpi_type',
  'BrandProfile.formality_level':       'formality_level',
  'VoiceProfile.formality_level':       'formality_level',
  'BrandProfile.humor_tolerance':       'humor_tolerance',
  'VoiceProfile.humor_tolerance':       'humor_tolerance',
  // Axis fields
  'BrandProfile.archetype_primary':     'archetype_primary',
  'BrandProfile.archetype_secondary':   'archetype_secondary',
  'BrandProfile.lifecycle_stage':       'lifecycle_stage',
  'BrandProfile.intent_state':          'intent_state',
  // Audience / Visual
  'AudienceProfile.gender_mix':         'primary_audience_gender',
  'AudienceProfile.primary_gender_mix': 'primary_audience_gender',
  'AudienceProfile.gender':             'primary_audience_gender',
  'AudienceProfile.bilingual_ratio':    'bilingual_ratio',
  'AudienceProfile.primary_kpi_type':   'primary_kpi_type',
  'BrandProfile.primary_audience_gender': 'primary_audience_gender',
  // AxisInference.* alias paths
  'AxisInference.archetype_primary':    'archetype_primary',
  'AxisInference.archetype_secondary':  'archetype_secondary',
  'AxisInference.lifecycle_stage':      'lifecycle_stage',
  'AxisInference.intent_state':         'intent_state',
  'AudienceProfile.description_ar':     'description_ar',
  'AudienceProfile.language_preference': 'language_preference',
  'VisualStyleProfile.style_descriptor': 'style_descriptor',
  'VisualStyleProfile.color_palette':   'color_palette',
  // Instagram analytics fields (migration 0094)
  'BrandProfile.followers_count':            'followers_count',
  'BrandProfile.ig_post_count':              'ig_post_count',
  'BrandProfile.account_type':               'account_type',
  'BrandProfile.bio_text':                   'bio_text',
  'BrandProfile.avg_engagement_rate':        'avg_engagement_rate',
  'BrandProfile.posting_frequency_per_week': 'posting_frequency_per_week',
  'BrandProfile.primary_content_format':     'primary_content_format',
  'BrandProfile.content_type_distribution':  'content_type_distribution',
  'BrandProfile.caption_avg_length':         'caption_avg_length',
  'BrandProfile.top_hashtags':               'top_hashtags',
  'BrandProfile.top_mentioned_accounts':     'top_mentioned_accounts',
  'AudienceProfile.audience_location_primary':   'audience_location_primary',
  'AudienceProfile.follower_quality_signal':     'follower_quality_signal',
  'VisualStyleProfile.avg_video_duration_secs':  'avg_video_duration_secs',
  'VisualStyleProfile.aspect_ratio_primary':     'aspect_ratio_primary',
  'VisualStyleProfile.filter_style':             'filter_style',
  'VisualStyleProfile.has_arabic_overlay':       'has_arabic_overlay',
  'VisualStyleProfile.has_logo_watermark':       'has_logo_watermark',
}

export interface NominationBuildContext {
  brand_id: string
  /** Map of source_origin → source_id, as returned by persistSourceRecords. */
  source_ids_by_origin: Record<string, string>
}

/**
 * Build the discriminated-union nomination list. Returns plain objects ready
 * for `enqueueNominations()` — Zod will validate them at the boundary.
 */
export function buildNominationsFromCoo(
  result: BuildBrandDnaResponse,
  ctx: NominationBuildContext,
): unknown[] {
  const nominations: unknown[] = []

  for (const fn of result.field_nominations) {
    const rawPath = fn.field_path
    const writePath = FIELD_PATH_REMAP[rawPath] ?? rawPath
    const memoryConfidence = COO_TO_MEMORY_CONFIDENCE[fn.confidence_state]
    if (!memoryConfidence) continue // unknown state — skip

    // (a) field_update — write the column itself, if confidence is high enough
    if (
      WRITEABLE_STATES.has(fn.confidence_state) &&
      fn.proposed_value !== null &&
      fn.proposed_value !== undefined
    ) {
      nominations.push({
        nomination_type: 'field_update',
        brand_id: ctx.brand_id,
        data: {
          field_path: writePath,
          proposed_value: fn.proposed_value,
          source: 'deepseek_output',
          reasoning: `COO field_nomination, confidence=${fn.confidence_state}, agreement=${fn.agreement_ratio}`,
        },
      })
    }

    // (b) confidence_upgrade — seed evidence_bundles so completeness can count
    const evidenceName = FIELD_PATH_TO_EVIDENCE_NAME[writePath] ?? null
    if (evidenceName) {
      // Map COO's `sources[]` (free-form origin tags) to source_record IDs we
      // just inserted. Drop any tag we don't have a row for — keeps Memory's
      // FK validation happy. If the result is empty AND the field is still
      // "evidenced" at form level, fall back to the form source_id if present.
      // Build the evidence_source_ids list:
      //  1. Map COO's `sources[]` tags (free-form origins) to source_record IDs
      //  2. ALWAYS add the form source if it exists — the form is the user's
      //     declaration and counts as evidence for everything they answered.
      //  3. Match scraper lanes by source_type (instagram/website/google_places)
      //     when COO tags don't exactly match what we hydrated.
      const evidenceIdsSet = new Set<string>()
      for (const tag of fn.sources) {
        const id = ctx.source_ids_by_origin[tag]
        if (id) evidenceIdsSet.add(id)
        // Permissive fallback: if tag mentions "form" / "instagram" / etc., match
        const lower = String(tag || '').toLowerCase()
        for (const [origin, sid] of Object.entries(ctx.source_ids_by_origin)) {
          if (lower.includes(origin.toLowerCase()) || origin.toLowerCase().includes(lower)) {
            evidenceIdsSet.add(sid)
          }
        }
      }
      // Always include the form as evidence if we have one — confidence_upgrade
      // requires at least one source_id and the form is the most authoritative
      // signal for any user-confirmed field.
      // FALLBACK: if form source_id doesn't exist, we use a synthetic ID
      // based on brand_id so evidence_bundles still gets created. This fixes
      // the bug where missing source_records caused evidence_bundles to stay empty.
      if (ctx.source_ids_by_origin.form) {
        evidenceIdsSet.add(ctx.source_ids_by_origin.form)
      } else {
        // Synthetic fallback: generate deterministic ID from brand_id
        const syntheticFormId = `form:${ctx.brand_id}:onboarding`
        evidenceIdsSet.add(syntheticFormId)
      }
      const evidenceIds = Array.from(evidenceIdsSet)
      if (evidenceIds.length > 0) {
        nominations.push({
          nomination_type: 'confidence_upgrade',
          brand_id: ctx.brand_id,
          data: {
            field_name: evidenceName,
            new_state: memoryConfidence,
            evidence_source_ids: evidenceIds,
            agreement_ratio: fn.agreement_ratio,
            reasoning: `COO build_branddna, source_count=${fn.sources.length}`,
          },
        })
      }
    }
  }

  // Three v2 axis fields — COO returns them in axis_inference, not in
  // field_nominations. Add them here so brand_profiles is updated.
  const axis = result.axis_inference
  if (axis) {
    const axisPushes: Array<[keyof typeof axis, string]> = [
      ['archetype_primary', 'BrandProfile.archetype_primary'],
      ['archetype_secondary', 'BrandProfile.archetype_secondary'],
      ['lifecycle_stage', 'BrandProfile.lifecycle_stage'],
      // intent_state is treated as form-driven only; already on brand_profiles
      // from the form server action. Don't overwrite from COO inference.
    ]
    for (const [key, path] of axisPushes) {
      const value = axis[key]
      const confKey = `${key === 'archetype_primary' || key === 'archetype_secondary' ? 'archetype' : 'lifecycle'}_confidence` as const
      const confidence = (axis as Record<string, string>)[confKey] ?? 'inferred_medium'
      const memoryConfidence = COO_TO_MEMORY_CONFIDENCE[confidence] ?? 'inferred_medium'
      if (value === null || value === undefined) continue
      if (WRITEABLE_STATES.has(confidence)) {
        nominations.push({
          nomination_type: 'field_update',
          brand_id: ctx.brand_id,
          data: {
            field_path: path,
            proposed_value: value,
            source: 'deepseek_output',
            reasoning: `COO axis_inference, confidence=${confidence}`,
          },
        })
      }
      const evidenceName = FIELD_PATH_TO_EVIDENCE_NAME[path]
      const formSourceId = ctx.source_ids_by_origin.form
      const igSourceId = ctx.source_ids_by_origin.instagram_profile ?? ctx.source_ids_by_origin.instagram
      const evidenceIds = [formSourceId, igSourceId].filter((x): x is string => !!x)
      if (evidenceName && evidenceIds.length > 0) {
        nominations.push({
          nomination_type: 'confidence_upgrade',
          brand_id: ctx.brand_id,
          data: {
            field_name: evidenceName,
            new_state: memoryConfidence,
            evidence_source_ids: evidenceIds,
            reasoning: 'COO axis_inference seed',
          },
        })
      }
    }
  }

  return nominations
}
