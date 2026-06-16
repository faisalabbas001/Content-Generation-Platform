/**
 * COO (Claude Haiku 4.5) — Zod schemas for the three COO jobs.
 *
 * Mirrors the JSON contracts in prompts/OGzStudios_COO_Prompt_v1.md §"Output schema"
 * for each of: build_branddna, compile_caption_context, score_confidence.
 */
import { z } from 'zod'

export const ConfidenceState = z.enum([
  'explicitly_confirmed',
  'inferred_high',
  'inferred_medium',
  'inferred_low',
  'missing',
])
export type ConfidenceState = z.infer<typeof ConfidenceState>

// Canonical source_type vocabulary (Doc §5.3). COO drifts and emits aliases
// like 'FORM_SUBMISSION', 'GOOGLE_BUSINESS_EXTRACTION', 'INSTAGRAM_PROFILE'.
// Rather than fail the entire response over this, we accept either the
// canonical value OR a known alias and remap before the strict enum check.
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  FORM_SUBMISSION: 'FORM_ANSWER',
  FORM: 'FORM_ANSWER',
  USER_FORM: 'FORM_ANSWER',
  REVIEW_FORM: 'FORM_ANSWER',
  INSTAGRAM: 'INSTAGRAM_SCRAPE',
  INSTAGRAM_PROFILE: 'INSTAGRAM_SCRAPE',
  INSTAGRAM_EXTRACTION: 'INSTAGRAM_SCRAPE',
  IG_SCRAPE: 'INSTAGRAM_SCRAPE',
  WEBSITE: 'WEBSITE_SCRAPE',
  WEBSITE_EXTRACTION: 'WEBSITE_SCRAPE',
  WEBSITE_HOMEPAGE: 'WEBSITE_SCRAPE',
  GOOGLE_BUSINESS_EXTRACTION: 'GOOGLE_BUSINESS',
  PLACES: 'GOOGLE_BUSINESS',
  GOOGLE_PLACES: 'GOOGLE_BUSINESS',
  SECTOR: 'SECTOR_BASELINE',
  BASELINE: 'SECTOR_BASELINE',
}
const CANONICAL_SOURCE_TYPES = ['FORM_ANSWER','INSTAGRAM_SCRAPE','WEBSITE_SCRAPE','GOOGLE_BUSINESS','SECTOR_BASELINE'] as const

export const SourceType = z.preprocess((val) => {
  if (typeof val !== 'string') return val
  if ((CANONICAL_SOURCE_TYPES as readonly string[]).includes(val)) return val
  const remapped = SOURCE_TYPE_ALIASES[val.toUpperCase()]
  return remapped ?? val
}, z.enum(CANONICAL_SOURCE_TYPES))

// ── Job 1 — build_branddna ────────────────────────────────────────
export const FieldNomination = z.object({
  field_path: z.string(),
  proposed_value: z.unknown().nullable(),
  confidence_state: ConfidenceState,
  confidence_score: z.number().min(0).max(1),
  sources: z.array(z.string()),
  agreement_ratio: z.number().min(0).max(1),
  conflict_flag: z.boolean(),
})

export const SourceRecord = z.object({
  source_type: SourceType,
  source_origin: z.string(),
  reliability_score: z.number().min(0).max(1),
  field_contributions: z.array(z.string()),
})

// ── v2 axis fields (Doc framework v2 § Phase 1 ask) ───────────────────
export const ArchetypeEnum = z.enum([
  'Innocent', 'Sage', 'Explorer', 'Outlaw',
  'Magician', 'Hero', 'Lover', 'Jester',
  'Everyman', 'Caregiver', 'Ruler', 'Creator',
])
export const LifecycleStageEnum = z.enum([
  'pre_launch', 'launch', 'growth', 'maturity', 'recovery',
])
export const IntentStateEnum = z.enum([
  'launch', 'grow', 'defend', 'harvest', 'recover',
])

// ── v2 method anatomy enums ───────────────────────────────────────────
export const VoiceRegisterEnum = z.enum([
  'intimate_humble', 'authoritative_warm', 'ironic_observer',
  'devotional_serene', 'playful_curious', 'crafted_precise',
])
export const DiagnosticPatternEnum = z.enum([
  'story_opener', 'question_opener', 'claim_opener',
  'contradiction_opener', 'observation_opener',
])
export const VisualIdiomEnum = z.enum([
  'minimal_natural_light', 'archive_film_grain', 'flat_graphic_warm',
  'editorial_dramatic', 'documentary_unposed', 'studio_polished',
])
export const CadenceRuleEnum = z.enum([
  'steady_drumbeat', 'burst_then_quiet', 'narrative_arc',
  'occasion_aligned', 'reactive_responsive',
])
export const ClosingPatternEnum = z.enum([
  'soft_invitation', 'direct_ask', 'open_question', 'no_close', 'community_call',
])
export const CreativeMethodEnum = z.enum([
  'Authenticity', 'Heritage', 'Metaphor', 'Paradox', 'Diagnostic', 'Vulnerability',
])

// All enum fields are nullable: when COO genuinely lacks evidence (e.g.
// form-only brand, no scraper signal), it may emit `null` rather than
// fabricate a method. Memory Controller's apply layer then no-ops the
// corresponding column update; the brand stays in `Cautious`/`Blocked`
// confidence mode and the next CEO call can ask the user to clarify.
// This is preferable to forcing Haiku into a hallucinated commitment.
export const MethodProfileResponse = z.object({
  voice_register:     VoiceRegisterEnum.nullable(),
  diagnostic_pattern: DiagnosticPatternEnum.nullable(),
  visual_idiom:       VisualIdiomEnum.nullable(),
  cadence_rule:       CadenceRuleEnum.nullable(),
  closing_pattern:    ClosingPatternEnum.nullable(),
  composition_blend:  z.record(
    z.enum(['voice', 'diagnostic', 'visual', 'cadence', 'closing']),
    CreativeMethodEnum,
  ),
  composition_score:  z.number().int().min(0).max(100),
  creative_direction_text: z.string().min(500).max(4000),
})
export type MethodProfileResponse = z.infer<typeof MethodProfileResponse>

export const AxisInference = z.object({
  archetype_primary:   ArchetypeEnum.nullable(),
  archetype_secondary: ArchetypeEnum.nullable(),
  lifecycle_stage:     LifecycleStageEnum.nullable(),
  intent_state:        IntentStateEnum.nullable(),
  archetype_confidence: ConfidenceState,
  lifecycle_confidence: ConfidenceState,
  intent_confidence:    ConfidenceState,
})
export type AxisInference = z.infer<typeof AxisInference>

// ── Build BrandDNA response — v2 shape ────────────────────────────────
// Adds the axis inference and method profile to the existing 10-field
// nominations payload. `field_nominations` length is now `min(10).max(12)` to
// accommodate the two new critical fields (archetype_primary, lifecycle_stage)
// that COO can also nominate as evidence rows.
export const BuildBrandDnaResponse = z.object({
  task_type: z.literal('build_branddna'),
  brand_id: z.string().uuid(),
  // 10 critical fields + 2 axis fields + 5 satellite fields (audience.* and
   // visual_style_profiles.*) = up to 17 nominations. Memory Controller still
   // only counts the 12 critical ones toward completeness_score.
  field_nominations: z.array(FieldNomination).min(10).max(20),
  completeness_score: z.number().int().min(0).max(100),
  dialect_confirmed: z.boolean(),
  critical_fields_missing: z.array(z.string()),
  source_records_to_create: z.array(SourceRecord),
  // v2: axis inference (archetype/lifecycle/intent)
  axis_inference: AxisInference,
  // v2: composed method profile from the matrix
  method_profile: MethodProfileResponse,
  reasoning: z.string().min(1),
})
export type BuildBrandDnaResponse = z.infer<typeof BuildBrandDnaResponse>

// ── Job 2 — compile_caption_context ───────────────────────────────
// 'direction' is a valid layer the COO emits when the brand's creative
// direction layer is included in the compiled context. It was missing from
// the original enum which caused StructuredJsonError on every compile call,
// forcing 3 retries (~72s extra latency) before permanent failure.
export const CaptionContextLayer = z.enum(['identity', 'direction', 'constraints', 'policy', 'saudi_guidance', 'direction'])

export const CompileCaptionContextResponse = z.object({
  task_type: z.literal('compile_caption_context'),
  brand_id: z.string().uuid(),
  caption_context: z.string().min(1),
  token_count: z.number().int().min(1).max(2000),
  // Use .catch([]) so any unknown future layer value degrades gracefully
  // (filters the bad value out) instead of throwing StructuredJsonError and
  // killing the entire compile. The context is still valid; one unknown layer
  // label is not worth failing the pipeline over.
  layers_included: z.array(
    CaptionContextLayer.catch(undefined as never)
  ).transform((arr) => arr.filter(Boolean)),
  watermark_flag: z.boolean(),
  cautious_register_flag: z.boolean(),
  cache_prefix_hash: z.string(),
  reasoning: z.string().min(1),
  cost_constrained: z.boolean().optional(),
  refusal: z.literal('cost_ceiling_breached').optional(),
})
export type CompileCaptionContextResponse = z.infer<typeof CompileCaptionContextResponse>

// ── Job 3 — score_confidence ──────────────────────────────────────
export const GateResult = z.enum(['clean', 'watermark_required', 'hold', 'blocked'])
export type GateResult = z.infer<typeof GateResult>

export const FloorReason = z
  .enum(['hard_block_negpat', 'missing_critical_field', 'cco_low_arabic_qc'])
  .nullable()

export const PostScore = z.object({
  post_id: z.string(),
  confidence_score: z.number().int().min(0).max(100),
  gate_result: GateResult,
  components: z.object({
    field_confidence_floor: z.number().min(0).max(1),
    arabic_qc_score: z.number().min(0).max(1),
    occasion_alignment: z.number().min(0).max(1),
    policy_compliance: z.number().min(0).max(1),
  }),
  floor_triggered: FloorReason,
})

export const ScoreConfidenceResponse = z.object({
  task_type: z.literal('score_confidence'),
  brand_id: z.string().uuid(),
  post_scores: z.array(PostScore),
  batch_summary: z.object({
    total_posts: z.number().int().nonnegative(),
    clean_count: z.number().int().nonnegative(),
    watermark_count: z.number().int().nonnegative(),
    hold_count: z.number().int().nonnegative(),
    blocked_count: z.number().int().nonnegative(),
  }),
  reasoning: z.string().min(1),
})
export type ScoreConfidenceResponse = z.infer<typeof ScoreConfidenceResponse>

// ── Job 4 — upgrade_readiness ─────────────────────────────────────
// Called by N8N-A05 monthly. COO receives brand metrics + evidence_bundles
// and returns a 0-100 recommendation_score with structured reasoning.
// This score feeds the 10% COO weight in A05's composite upgrade formula.

export const UpgradeSignal = z.object({
  signal:   z.string(),          // human-readable signal label
  positive: z.boolean(),         // true = supports upgrade, false = concern
  weight:   z.number().min(0).max(1),
})

export const UpgradeReadinessResponse = z.object({
  task_type: z.literal('upgrade_readiness'),
  brand_id: z.string().uuid(),
  recommendation_score: z.number().int().min(0).max(100),
  readiness_tier: z.enum(['highly_ready', 'ready', 'potential', 'not_ready']),
  signals: z.array(UpgradeSignal).min(1).max(10),
  upgrade_offer_suggestion: z.string().max(200),
  reasoning: z.string().min(1),
})
export type UpgradeReadinessResponse = z.infer<typeof UpgradeReadinessResponse>

/** Discriminated union — useful when n8n forwards a generic COO response. */
export const CooResponse = z.discriminatedUnion('task_type', [
  BuildBrandDnaResponse,
  CompileCaptionContextResponse,
  ScoreConfidenceResponse,
  UpgradeReadinessResponse,
])
export type CooResponse = z.infer<typeof CooResponse>

// ── Input shapes ──────────────────────────────────────────────────
export type CooTaskType = 'build_branddna' | 'compile_caption_context' | 'score_confidence' | 'upgrade_readiness'

export interface CooInput {
  task_type: CooTaskType
  brand_id: string
  payload: Record<string, unknown>
}
