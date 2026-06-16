/**
 * CEO (DeepSeek deepseek-chat) — Zod schemas for routing decisions.
 *
 * Mirrors the JSON contract in prompts/OGzStudios_CEO_Prompt_v2.md §"Output format".
 * Every field is REQUIRED (use null / [] for empty); the prompt forbids omissions.
 * Validation failures count as a parse error and trigger one retry per Doc §5.4.
 */
import { z } from 'zod'

export const RequestType = z.enum([
  'calendar_scheduled',
  'calendar_ondemand',
  'onboarding_new',
  'revision',
  'brand_correction',
  'anomaly_alert',
  'upgrade_signal',
])
export type RequestType = z.infer<typeof RequestType>

export const ConfidenceMode = z.enum(['Standard', 'Cautious', 'Minimal', 'Blocked'])
export type ConfidenceMode = z.infer<typeof ConfidenceMode>

export const CostStatus = z.enum(['normal', 'approaching', 'critical', 'breached'])
export type CostStatus = z.infer<typeof CostStatus>

export const PipelineId = z.enum(['A', 'memory_only', 'ops'])
export type PipelineId = z.infer<typeof PipelineId>

/** 12 human-gate triggers (v2 adds method_violation — CEO Prompt v2 §Step 7). */
export const HumanGateReason = z.enum([
  'first_ever_client_output',
  'brave_route_flagged',
  'healthcare_health_claim',
  'finance_investment_claim',
  'government_sector',
  'religious_reference_high_sensitivity',
  'dialect_unconfirmed_hero',
  'unresolved_conflict_record',
  'revision_cycle_exceeded',
  'cco_low_confidence',
  'hard_block_negative_pattern',
  // v2 — COO Job 3 method_adherence_score < 40 on any post
  'method_violation',
  // OGZ Internal Review — a client clicked "Request Changes" and the system
  // routes the revision through admin BEFORE firing N8N-B03 (Saudi PDPL +
  // cultural-sensitivity safeguard, OGZ doc §5.4).
  'user_revision_request',
  'blocked_critical_field_missing',
  'cost_ceiling_breached',
  'unknown_request_type',
  // Onboarding-specific reasons CEO emits naturally during build_branddna.
  // Added so the lenient parser keeps them instead of dropping silently.
  'onboarding_new_no_prior_branddna',
  'onboarding_new_brand_no_branddna_exists',
  'zero_inference_sources',
  'intake_form_incomplete',
])
export type HumanGateReason = z.infer<typeof HumanGateReason>

const HUMAN_GATE_REASON_VALUES = new Set(HumanGateReason.options as readonly string[])

/**
 * Lenient parser for human_gate_reasons[].
 *
 * The CEO model frequently appends free-form explanations to the canonical
 * enum identifier, e.g.:
 *   "blocked_critical_field_missing — brand is new; all 12 critical fields..."
 *
 * It also occasionally invents new identifiers like
 * "onboarding_new_no_prior_branddna" or
 * "zero_inference_sources_instagram_absent_website_absent" that aren't in
 * the enum at all.
 *
 * Rather than fail the whole CEO call on a creative output (forcing 2× retries
 * + an n8n timeout), we coerce: take the leading token, strip any trailing
 * explanation, and DROP values that don't match the enum. The model's reasoning
 * is preserved in `routing_decision.reasoning` either way.
 */
export const HumanGateReasonsArray = z
  .array(z.unknown())
  .transform((arr) => {
    // Sort enum values by length descending — longest match wins, so
    // `zero_inference_sources_instagram_absent_website_absent` collapses to
    // `zero_inference_sources` (canonical) instead of `zero` (gibberish).
    const sortedValues = [...HUMAN_GATE_REASON_VALUES].sort((a, b) => b.length - a.length)
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of arr) {
      if (typeof v !== 'string') continue
      const lower = v.trim().toLowerCase()
      // 1. Try the leading token (everything before first whitespace / em-dash / en-dash).
      const head = lower.split(/[\s—–]/)[0]?.trim() ?? ''
      if (HUMAN_GATE_REASON_VALUES.has(head)) {
        if (!seen.has(head)) { seen.add(head); out.push(head) }
        continue
      }
      // 2. Try longest-prefix match — the model often appends extra context
      //    with underscores (e.g. `zero_inference_sources_instagram_absent_website_absent`).
      const matched = sortedValues.find((canonical) => lower.startsWith(canonical))
      if (matched && !seen.has(matched)) {
        seen.add(matched)
        out.push(matched)
      }
      // 3. Otherwise drop — the model invented something we can't map.
    }
    return out
  })
  .pipe(z.array(HumanGateReason))

const ANOMALY_FLAG_VALUES = [
  'cost_spike_detected',
  'namespace_breach_attempt',
  'cco_systematic_failure',
  'weavy_api_unavailable',
  'unknown_request_type',
  'conflict_record_unresolved',
  'value_conflict_in_submission',
    // v2 — >30% of recent posts have method_adherence_score < 50
    'method_drift_detected',
    'unrecognized_occasion_flag',
    'unresolved_occasion_flag',
  'method_drift_detected', // v2 — archetype mis-classification signal
] as const

export const AnomalyFlag = z
  .union([
    z.enum(ANOMALY_FLAG_VALUES),
    // Coerce unknown strings or hallucinated objects to null instead of crashing.
    // Claude occasionally returns a full object here for anomaly_alert requests.
    z.string().transform(() => null),
    z.record(z.unknown()).transform(() => null),
    z.array(z.unknown()).transform(() => null),
    z.null(),
  ])

export const MemoryNominationFamily = z.enum([
  'Identity',
  'Policy',
  'Evidence',
  'Memory',
  'Learning',
  // v2 — added for routing-trace and audit nominations that don't fit the
  // four BrandDNA-bearing families. Memory Controller treats Operational
  // nominations as decision_trace-only — they never write to Layer 1 tables.
  'Operational',
])

const NOMINATION_SOURCE_VALUES = [
  'client_confirmation',
  'cco_qc',
  'deepseek_output',
  'system_inference',
  'client_correction_form',
  'client_confirmation_pending',
] as const

// Lenient: CEO sometimes returns abbreviated values like 'correction_form' or 'system'.
// Coerce unknowns to 'system_inference' (closest safe default) instead of crashing.
const NominationSource = z.union([
  z.enum(NOMINATION_SOURCE_VALUES),
  z.string().transform(() => 'system_inference' as const),
])

export const MemoryNomination = z.object({
  // .catch() on enums — model occasionally returns unexpected values or casing.
  nomination_type: z.enum(['field_update', 'event_log', 'decision_trace', 'conflict_flag', 'method_profile_update']).catch('decision_trace' as const),
  family: MemoryNominationFamily.catch('Operational' as const),
  // CEO returns null field_path for event_log / decision_trace nominations (no field
  // delta to write — only field_update carries a real path). Accept null + coalesce to
  // '' so a valid batch-complete response is not rejected (was causing retries/parse FAIL).
  field_path: z.string().catch('').nullable().transform((v) => v ?? ''),
  proposed_value: z.unknown(),
  source: NominationSource,
  // CEO returns null on event_log / decision_trace nominations where there is
  // no delta to record (only field_update / confidence_upgrade carry a real
  // delta). Accept string, object, or null — prompt v2 may return a structured
  // delta object for method_profile_update nominations.
  confidence_delta: z.union([z.string(), z.record(z.unknown()), z.null()]),
  human_review_required: z.boolean().catch(true),
})
export type MemoryNomination = z.infer<typeof MemoryNomination>

export const ConstraintPayload = z
  .object({
    brand_id: z.string().uuid(),
    namespace: z.string(),
    confidence_mode: ConfidenceMode,
    occasion_flags: z.array(z.string()),
    cost_constraint: CostStatus,
    sector_baseline_id: z.string().uuid().nullable(),
    prohibited_patterns: z.array(z.string()),
    platform_spec: z.string(),
    arabic_dialect: z.string(),
    tone_attribute_ids: z.array(z.string()),
    visual_style_ids: z.array(z.string()),
    content_mix: z.unknown(),
    watermark_required: z.boolean(),
  })
  .passthrough()
export type ConstraintPayload = z.infer<typeof ConstraintPayload>

export const RoutingDecision = z.object({
  // Relax UUID — DeepSeek generates readable IDs ("decision_001") not proper UUIDs.
  decision_id: z.string().catch('00000000-0000-0000-0000-000000000000'),
  brand_id: z.string().uuid().nullable().catch(null),
  request_type: RequestType.catch('calendar_scheduled' as const),
  pipeline: PipelineId.catch('A' as const),
  confidence_mode: ConfidenceMode.catch('Standard' as const),
  // min(1) was too strict — model returns [] occasionally; default to ["none"]
  occasion_flags: z.array(z.string()).catch(['none']),
  cost_status: CostStatus.catch('normal' as const),
  agents_to_dispatch: z.array(z.enum(['COO', 'CCO', 'DeepSeek'])).catch([]),
  constraint_payload: z.union([ConstraintPayload, z.record(z.unknown())]),
  // Default true (safer — holds post for review rather than silently skipping it)
  human_gate_required: z.boolean().catch(true),
  human_gate_reasons: HumanGateReasonsArray,
  anomaly_flag: AnomalyFlag,
  reasoning: z.string().min(1).catch('no reasoning provided'),
  memory_nominations: z.array(MemoryNomination).catch([]),
  /**
   * @deprecated Chain selection moved out of the CEO (Doc §9.5 — deterministic,
   * no-LLM, per-slot in /api/agents/calendar/plan-slots). Kept optional so the LLM
   * response still validates and old audit rows are unaffected. Ignored by callers.
   */
  selected_chain: z.string().nullable().optional(),
  /** @deprecated See selected_chain — chain context now comes from the slot planner. */
  chain_context: z.object({
    product_descriptor: z.string(),
  }).nullable().optional(),
  /** @deprecated Format (image/video) is now decided per-slot by the calendar planner. */
  format_tier: z.enum(['image', 'video']).default('image'),
})
export type RoutingDecision = z.infer<typeof RoutingDecision>

/** Top-level wrapper — the prompt always emits `{ "routing_decision": {...} }`. */
export const CeoResponse = z.object({
  routing_decision: RoutingDecision,
})
export type CeoResponse = z.infer<typeof CeoResponse>

// ── QA flags shape — mirrors the flags JSONB column in qa_review_queue ──
export const QaFlagsSchema = z.object({
  negpat_flag:                  z.enum(['SOFT_WARN', 'STRONG_WARN', 'HARD_BLOCK']).optional(),
  brave_route_flag:             z.boolean().optional(),
  dialect_flag:                 z.boolean().optional(),
  cultural_flag:                z.boolean().optional(),
  health_claim_detected:        z.boolean().optional(),
  religious_reference_detected: z.boolean().optional(),
  method_adherence_score:       z.number().optional(),
  is_blocked:                   z.boolean().optional(),
  source_flow:                  z.string().optional(),
  anomaly_id:                   z.string().optional(),
}).passthrough()
export type QaFlags = z.infer<typeof QaFlagsSchema>

// ── Input shapes (TypeScript types — not validated; we author them) ───

export interface CeoInput {
  flow_id: string
  request_type: RequestType
  brand_id: string | null
  trigger_payload: Record<string, unknown>
  evidence_bundle_states?: Record<string, string>
  occasion_flags?: string[]
  current_month_spend_usd?: number
  monthly_ceiling_usd?: number
  /** Set on the post-QC confidence-gate call. */
  cco_results?: Array<{ post_id: string; score: number; brave_route_flag: boolean; negpat_flag: string }>
  /**
   * Pre-filtered chain shortlist (calendar_ondemand only).
   * Signals 1-3 (sector, quality_tier, cultural safety) already applied in code.
   * CEO applies signals 4-5 (occasion + content type) and scores to pick one.
   * Each element is a chain object (chain_id, name_en, family, output_type, purpose,
   * cost_estimate_usd, models_used, eligibility_filters, cultural_constraints).
   * Empty array or absent = CEO sets selected_chain: null.
   */
  available_chains?: Array<Record<string, unknown>>
  /** Brand quality tier — passed so CEO can log it in reasoning. */
  brand_quality_tier?: string
}
