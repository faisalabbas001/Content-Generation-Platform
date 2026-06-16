/**
 * POST /api/agents/ceo/confidence-gate
 *
 * CEO Step 7 — runs AFTER CCO returns Arabic QC scores AND visual-qc has
 * scored the generated image. Checks all 11 human-gate triggers (Doc §6.4)
 * and computes the composite confidence_score from 4 pillars:
 *
 *   Pillar 1 — Visual quality (35%)   ← NEW: from visual-qc
 *   Pillar 2 — Caption quality (30%)  ← CCO cco_score
 *   Pillar 3 — Brand/BrandDNA fit (20%) ← field_confidence_floor
 *   Pillar 4 — Occasion alignment (15%) ← occasion + cultural flags
 *
 * Image ALWAYS generates. Score determines routing (clean / watermark / hold)
 * and the quality signal visible to the admin in /admin/qa. The score NEVER
 * blocks image generation — it only affects routing.
 *
 * Called only by N8N-A01 / N8N-A02 / N8N-B03.
 */
import { adminClient } from '@repo/db/client'
import { ceo, applyHumanOverrides, shouldAlertAdmin, type OverridePost, type OverrideContext } from '@repo/ai'
import { enqueueNominations, translateCeoNominations } from '@repo/memory'
import { z } from 'zod'
import { schemas } from '@repo/core'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Number of leading slots treated as "hero content" for trigger 7 (doc §6.4 #7).
const HERO_SLOT_COUNT = 3

// ── Composite scoring weights ────────────────────────────────────────────────
// These mirror the 4-pillar model from the system doc. Must sum to 1.0.
const WEIGHT_VISUAL   = 0.35  // Pillar 1: image quality (visual-qc)
const WEIGHT_CAPTION  = 0.30  // Pillar 2: Arabic caption quality (CCO)
const WEIGHT_BRAND    = 0.20  // Pillar 3: BrandDNA field confidence
const WEIGHT_OCCASION = 0.15  // Pillar 4: occasion + cultural alignment

// Routing thresholds — per OGZ_COMPLETE_SYSTEM_DOCUMENT §9.6:
//   ≥75 → clean delivery
//   50–74 → watermarked, human QC recommended
//   <50 → regenerate or escalate
const THRESHOLD_CLEAN      = 75
const THRESHOLD_WATERMARK  = 50

// ── Input schemas ────────────────────────────────────────────────────────────

const CcoResultRow = z.object({
  post_id: z.string(),
  score: z.number().int().min(0).max(100),
  brave_route_flag: z.boolean(),
  negpat_flag: z.string(),
  cultural_flag: z.boolean().optional(),
  dialect_flag: z.boolean().optional(),
  issues: z.array(z.string()).optional(),
  content_type: z.string().optional(),
})

// Per-post visual QC result forwarded from N8N after visual-qc runs.
// Optional: when absent the pillar defaults to neutral (80) so the pipeline
// never blocks when visual-qc wasn't wired yet.
const VisualQcResult = z.object({
  post_id:      z.string(),
  visual_score: z.number().min(0).max(100),
  violations:   z.array(z.string()).optional(),
  visual_issues: z.array(z.object({
    code:     z.string(),
    label:    z.string(),
    severity: z.enum(['high', 'med', 'low']),
    detail:   z.string().optional(),
  })).optional(),
  pillars: z.object({
    hard_block_pass:     z.boolean(),
    chain_fidelity:      z.number(),
    style_register:      z.number(),
    occasion_alignment:  z.number(),
    composition_quality: z.number(),
  }).optional(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    request_type: schemas.RequestType,
    trigger_payload: z.record(z.unknown()).default({}),
    cco_results: z.array(CcoResultRow).min(1),
    // Visual QC results — one per post, matched by post_id.
    // N8N-A01/A02 must forward these after the visual-qc node runs.
    // Missing entries degrade to visual_score=80 (neutral, no penalty).
    visual_qc_results: z.array(VisualQcResult).optional(),
    evidence_bundle_states: z.record(z.string()).optional(),
    occasion_flags: z.array(z.string()).optional(),
    selected_chain: z.string().nullable().optional(),
    chain_context: z.object({ product_descriptor: z.string() }).nullable().optional(),
  }),
})

// ── Composite confidence score ────────────────────────────────────────────────
//
// Per OGZ_COMPLETE_SYSTEM_DOCUMENT §9.3 Confidence Scorer:
//   "Takes CCO result + Arabic validation + brand history → final score"
//
// Per §9.6 Generation Flow routing:
//   ≥75 clean · 50-74 watermark · <50 regenerate/escalate
//
// Pillar 1 — Visual (35%): GPT-4o image QC score (0-100).
//   Hard block in image → visual_score=0 → composite=0, HOLD.
//
// Pillar 2 — Caption (30%): CCO Arabic quality score (0-100).
//   score<50 also fires Trigger 10 (HOLD) independently via human overrides.
//
// Pillar 3 — Brand history (20%): per §9.5 chain scoring:
//   - Brand's historical approval rate for this chain (0-40 pts)
//   - Style register match from BrandDNA field_confidence (0-30 pts)
//   Combined into 0-100. Falls back to field_confidence floor when no history.
//
// Pillar 4 — Occasion alignment (15%): occasion_flags + cultural_flag from CCO.
//   No occasion active = 1.0 (full). Active + no cultural flag = 1.0.
//   Active + cultural_flag fired = 0.3. NEGPAT multipliers applied.

function computeCompositeScore(opts: {
  visual_score: number | null  // null = visual QC not yet run (pillar excluded from composite)
  cco_score: number
  negpat_flag: string
  cultural_flag: boolean
  occasion_flags: string[]
  evidence_bundle_states: Record<string, string>
  // Brand history — from confidence_benchmarks / performance_memory
  chain_approval_rate?: number | null   // 0.0–1.0, null = no history yet
  brand_avg_confidence?: number | null  // 0–100, null = no history yet
}): {
  composite: number
  pillars: {
    visual: number | null  // null when visual QC has not run
    caption: number
    brand_fit: number
    occasion: number
  }
  route: 'clean' | 'watermark' | 'hold'
  hard_blocked: boolean
} {
  const {
    visual_score, cco_score, negpat_flag, cultural_flag, occasion_flags,
    evidence_bundle_states, chain_approval_rate, brand_avg_confidence,
  } = opts

  // Hard blocks → composite = 0 immediately (non-negotiable)
  // visual_score === 0 is a hard block only when visual QC has actually run (not null)
  const visualHardBlock = visual_score !== null && visual_score === 0
  const negpatHardBlock = negpat_flag === 'HARD_BLOCK'
  if (visualHardBlock || negpatHardBlock) {
    return {
      composite: 0,
      pillars: { visual: visual_score, caption: 0, brand_fit: 0, occasion: 0 },
      route: 'hold',
      hard_blocked: true,
    }
  }

  // Pillar 1 — Visual quality (null = not yet scored)
  const pillar_visual = visual_score  // 0-100 from visual-qc, or null

  // Pillar 2 — Caption quality
  const pillar_caption = cco_score  // 0-100 from CCO

  // Pillar 3 — Brand history + BrandDNA fit (doc §9.5 chain scoring)
  // Sub-score A: chain approval rate (brand's historical performance on this chain type)
  //   chain_approval_rate comes from confidence_benchmarks.approval_rate
  //   Per doc: ≥60% is the floor before chain is flagged; map 0.0-1.0 → 0-100
  //   No history yet → default 0.70 (assume average, don't penalise new brands)
  const approvalRateScore = chain_approval_rate !== null && chain_approval_rate !== undefined
    ? Math.min(chain_approval_rate * 100, 100)
    : 70  // neutral default for brands with no history

  // Sub-score B: BrandDNA field_confidence floor on critical fields
  //   Per doc: field_confidence states reflect how well the brand profile is known.
  //   A brand with all explicitly_confirmed fields = full trust in brand alignment.
  //   Missing critical fields = system can't confirm brand fit → penalise.
  const CONFIDENCE_MAP: Record<string, number> = {
    explicitly_confirmed: 1.0,
    inferred_high:        0.9,
    inferred_medium:      0.7,
    inferred_low:         0.4,
    rejected:             0.0,
    deprecated:           0.0,
  }
  const CRITICAL_FIELDS = [
    'arabic_dialect', 'brand_differentiator', 'price_position', 'primary_channel',
    'ramadan_relevance', 'primary_audience_gender', 'primary_kpi_type',
    'religious_sensitivity', 'tone_anti_attribute_ids', 'bilingual_ratio',
  ]
  let fieldConfidenceFloor = 1.0
  for (const field of CRITICAL_FIELDS) {
    const state = evidence_bundle_states[field]
    const conf = state ? (CONFIDENCE_MAP[state] ?? 0.0) : 0.7  // unknown = inferred_medium
    if (conf < fieldConfidenceFloor) fieldConfidenceFloor = conf
  }
  const fieldConfidenceScore = fieldConfidenceFloor * 100

  // Blend: approval rate (60% weight) + field confidence (40% weight)
  // If brand has avg historical confidence, use it to nudge the field score
  const avgConfAdjustment = brand_avg_confidence !== null && brand_avg_confidence !== undefined
    ? (brand_avg_confidence - 70) * 0.2  // ±nudge based on past performance
    : 0
  const pillar_brand = Math.max(0, Math.min(100, Math.round(
    approvalRateScore * 0.6 +
    (fieldConfidenceScore + avgConfAdjustment) * 0.4
  )))

  // Pillar 4 — Occasion alignment
  let occasion_ratio = 1.0
  const hasActiveOccasion = occasion_flags.length > 0
  if (hasActiveOccasion && cultural_flag) {
    occasion_ratio = 0.3  // occasion active + cultural flag fired
  }
  const negpatMultiplier = negpat_flag === 'STRONG_WARN' ? 0.7 : negpat_flag === 'SOFT_WARN' ? 0.85 : 1.0
  const pillar_occasion = Math.round(occasion_ratio * negpatMultiplier * 100)

  // Weighted composite — doc thresholds: ≥75 clean, 50-74 watermark, <50 hold
  // When visual QC hasn't run yet (pillar_visual=null), exclude it and renormalize
  // the remaining 3 pillar weights so the composite reflects only scored pillars.
  let composite: number
  if (pillar_visual === null) {
    // Remaining weights: caption 0.30, brand 0.20, occasion 0.15 → total 0.65
    const remainingTotal = WEIGHT_CAPTION + WEIGHT_BRAND + WEIGHT_OCCASION
    composite = Math.round(
      (pillar_caption  * WEIGHT_CAPTION +
       pillar_brand    * WEIGHT_BRAND +
       pillar_occasion * WEIGHT_OCCASION) / remainingTotal * 100,
    )
  } else {
    composite = Math.round(
      pillar_visual   * WEIGHT_VISUAL +
      pillar_caption  * WEIGHT_CAPTION +
      pillar_brand    * WEIGHT_BRAND +
      pillar_occasion * WEIGHT_OCCASION,
    )
  }

  const route: 'clean' | 'watermark' | 'hold' =
    composite >= THRESHOLD_CLEAN     ? 'clean' :
    composite >= THRESHOLD_WATERMARK ? 'watermark' : 'hold'

  return {
    composite,
    pillars: {
      visual:    pillar_visual !== null ? Math.round(pillar_visual) : null,
      caption:   Math.round(pillar_caption),
      brand_fit: pillar_brand,
      occasion:  pillar_occasion,
    },
    route,
    hard_blocked: false,
  }
}

/**
 * Resolve all data the 11 triggers need, then evaluate them deterministically.
 * Every DB read degrades gracefully — a missing table/column disables only the
 * trigger that depends on it (never throws, never blocks the calendar).
 */
async function computeHumanOverrides(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  brand_id: string,
  ccoResults: Array<z.infer<typeof CcoResultRow>>,
) {
  // Brand context (sector, religious sensitivity, first-ever flag).
  let sector: string | null = null
  let religious_sensitivity: string | null = null
  let total_calendars_generated = 0
  try {
    const { data: brand } = await db
      .from('brand_profiles')
      .select('sector, religious_sensitivity, total_calendars_generated')
      .eq('brand_id', brand_id)
      .maybeSingle()
    sector = brand?.sector ?? null
    religious_sensitivity = brand?.religious_sensitivity ?? null
    total_calendars_generated = brand?.total_calendars_generated ?? 0
  } catch { /* trigger 1/3/4/5/6 degrade to off */ }

  // Trigger 7 — dialect confidence (inferred_low). Stored per-field in
  // evidence_bundles (field_name + field_confidence). We read the arabic_dialect
  // field's confidence; 'inferred_low' fires the trigger on hero content.
  let dialect_confidence: string | null = null
  try {
    const { data: dia } = await db
      .from('evidence_bundles')
      .select('field_confidence')
      .eq('brand_id', brand_id)
      .eq('field_name', 'arabic_dialect')
      .maybeSingle()
    dialect_confidence = (dia as { field_confidence?: string } | null)?.field_confidence ?? null
  } catch { /* trigger 7 degrades to off */ }

  // Trigger 8 — unresolved conflict on a critical field. The documented
  // `conflict_records` table may not exist yet → best-effort, default false.
  let has_unresolved_conflict = false
  try {
    const { data: conflicts, error } = await db
      .from('conflict_records')
      .select('id')
      .eq('brand_id', brand_id)
      .eq('status', 'unresolved')
      .limit(1)
    if (!error && Array.isArray(conflicts) && conflicts.length > 0) has_unresolved_conflict = true
  } catch { /* table absent → trigger 8 off (logged once below) */ }

  // Trigger 9 — revision_count per post_id (calendar_posts).
  const revisionByPost: Record<string, number> = {}
  try {
    const ids = ccoResults.map((c) => c.post_id)
    if (ids.length > 0) {
      const { data: rows } = await db
        .from('calendar_posts')
        .select('post_id, revision_count')
        .in('post_id', ids)
      for (const r of (rows ?? []) as Array<{ post_id: string; revision_count: number | null }>) {
        revisionByPost[r.post_id] = r.revision_count ?? 0
      }
    }
  } catch { /* trigger 9 degrades to 0 */ }

  const ctx: OverrideContext = {
    sector,
    religious_sensitivity,
    total_calendars_generated,
    dialect_confidence,
    has_unresolved_conflict,
  }

  const posts: OverridePost[] = ccoResults.map((c, i) => ({
    post_id: c.post_id,
    score: c.score,
    brave_route_flag: c.brave_route_flag,
    negpat_flag: c.negpat_flag,
    cultural_flag: c.cultural_flag,
    dialect_flag: c.dialect_flag,
    issues: c.issues ?? [],
    content_type: c.content_type,
    is_hero: i < HERO_SLOT_COUNT, // leading slots are hero content (doc §6.4 #7)
    revision_count: revisionByPost[c.post_id] ?? 0,
  }))

  return applyHumanOverrides(ctx, posts)
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'unknown_flow',
  handler: async (input, ctx) => {
    const db = adminClient()

    // ── Build visual QC lookup map (post_id → result) ────────────────────
    // N8N-A01/A02 run visual-qc after image generation and forward results here.
    // When absent for a post, we default to visual_score=80 (neutral — no penalty).
    const visualByPost = new Map<string, z.infer<typeof VisualQcResult>>()
    for (const vr of (input.payload.visual_qc_results ?? [])) {
      visualByPost.set(vr.post_id, vr)
    }

    // ── Compute composite confidence score per post ───────────────────────
    // This is the intelligent 4-pillar formula. Score NEVER blocks generation —
    // it only determines routing (clean/watermark/hold) visible to admin.
    const evidenceBundleStates = (input.payload.evidence_bundle_states ?? {}) as Record<string, string>
    const occasionFlags = input.payload.occasion_flags ?? []

    // Fetch brand history for Pillar 3 (doc §9.5 chain scoring):
    //   chain_approval_rate = how often this brand's posts get approved vs regenerated
    //   brand_avg_confidence = historical average composite score for this brand
    // Both degrade gracefully: null = no history yet → defaults applied in computeCompositeScore
    let chainApprovalRate: number | null = null
    let brandAvgConfidence: number | null = null
    try {
      // confidence_benchmarks may not exist in the generated types yet (added by migration)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bench } = await (db as any)
        .from('confidence_benchmarks')
        .select('approval_rate, avg_confidence_score')
        .eq('brand_id', input.brand_id)
        .maybeSingle()
      if (bench) {
        chainApprovalRate  = typeof (bench as Record<string,unknown>).approval_rate         === 'number' ? (bench as Record<string,unknown>).approval_rate         as number : null
        brandAvgConfidence = typeof (bench as Record<string,unknown>).avg_confidence_score  === 'number' ? (bench as Record<string,unknown>).avg_confidence_score  as number : null
      }
    } catch { /* confidence_benchmarks absent → Pillar 3 falls back to field-confidence floor */ }

    const compositeByPost = new Map<string, ReturnType<typeof computeCompositeScore>>()
    for (const cco of input.payload.cco_results) {
      const vqc = visualByPost.get(cco.post_id)
      const scored = computeCompositeScore({
        visual_score:           vqc?.visual_score ?? null,
        cco_score:              cco.score,
        negpat_flag:            cco.negpat_flag,
        cultural_flag:          cco.cultural_flag ?? false,
        occasion_flags:         occasionFlags,
        evidence_bundle_states: evidenceBundleStates,
        chain_approval_rate:    chainApprovalRate,
        brand_avg_confidence:   brandAvgConfidence,
      })
      compositeByPost.set(cco.post_id, scored)
    }

    // ── Write composite scores to calendar_posts ─────────────────────────
    // Best-effort: pipeline never blocks on a DB write failure here.
    const scoreUpdates = input.payload.cco_results.map((cco) => {
      const scored = compositeByPost.get(cco.post_id)!
      const vqc    = visualByPost.get(cco.post_id)
      return db
        .from('calendar_posts')
        .update({
          confidence_score: scored.composite,
          visual_score:     vqc?.visual_score ?? null,
          visual_issues:    vqc?.visual_issues ?? [],
          flags:            { pillars: scored.pillars },
        } as never)
        .eq('post_id', cco.post_id)
    })
    try {
      await Promise.allSettled(scoreUpdates)
    } catch { /* non-fatal */ }

    // ── Inject composite scores back into cco_results for CEO gate ────────
    // The CEO gate LLM sees the composite score (not the raw CCO score) so its
    // routing reasoning is grounded in the real multi-pillar quality signal.
    const enrichedCcoResults = input.payload.cco_results.map((cco) => ({
      ...cco,
      score: compositeByPost.get(cco.post_id)?.composite ?? cco.score,
    }))

    const decision = await ceo.confidenceGate(
      {
        flow_id: input.flow_id,
        request_type: input.payload.request_type,
        brand_id: input.brand_id,
        trigger_payload: input.payload.trigger_payload,
        cco_results: enrichedCcoResults,
        evidence_bundle_states: input.payload.evidence_bundle_states,
        occasion_flags: input.payload.occasion_flags,
      },
      { flow_id: ctx.flowId, brand_id: input.brand_id, db },
    )

    // Auto-enqueue any memory_nominations from the gate output.
    let nominations_enqueued = 0
    let nominations_dropped = 0
    if (Array.isArray(decision.memory_nominations) && decision.memory_nominations.length > 0) {
      const translated = translateCeoNominations(decision.brand_id, decision.memory_nominations)
      nominations_dropped = translated.dropped.length
      if (translated.nominations.length > 0) {
        const r = await enqueueNominations(db, translated.nominations, { nominated_by: 'CEO' })
        nominations_enqueued = r.enqueued + r.skipped_duplicates
      }
    }

    // Restore the chain selected at classify time (Step 1). CEO at Step 7 has
    // no available_chains so always returns selected_chain: null — override it
    // here so the response N8N reads still carries the correct chain forward to V01.
    if (input.payload.selected_chain !== undefined) {
      decision.selected_chain  = input.payload.selected_chain ?? null
      decision.chain_context   = input.payload.chain_context  ?? null
    }

    // ── The 11 Human Override Triggers (Doc §6.4) — DETERMINISTIC post-process ──
    // Safety-critical: never trust the LLM alone to apply these. We compute holds
    // in code and force them onto the decision. Per Point 1, a hold NEVER blocks
    // generation — it flags the post + routes it to /admin/qa for human review.
    //
    // Additional visual-score-based hold rule:
    //   Any post with visual hard block (visual_score=0) is treated exactly like
    //   Trigger 11 (HARD_BLOCK negpat) — routed to admin QA with reason 'visual_hard_block'.
    const overrides = await computeHumanOverrides(db, input.brand_id, enrichedCcoResults)
    if (overrides.human_gate_required) {
      decision.human_gate_required = true
      const existing = new Set((decision.human_gate_reasons ?? []).map(String))
      for (const t of overrides.calendar_reasons) existing.add(t.reason)
      for (const arr of Object.values(overrides.per_post)) for (const t of arr) existing.add(t.reason)
      decision.human_gate_reasons = schemas.HumanGateReasonsArray.parse(Array.from(existing))
    }

    // Hard-block visual posts: add hold reason + mark human_gate_required
    for (const [postId, scored] of compositeByPost.entries()) {
      if (scored.hard_blocked) {
        decision.human_gate_required = true
        const existing = new Set((decision.human_gate_reasons ?? []).map(String))
        existing.add('hard_block_negative_pattern')
        decision.human_gate_reasons = schemas.HumanGateReasonsArray.parse(Array.from(existing))
        // Also write to qa_review_queue for this post (best-effort)
        const vqc = visualByPost.get(postId)
        if (vqc?.violations && vqc.violations.length > 0) {
          try {
            await db.from('qa_review_queue').upsert({
              brand_id:       input.brand_id,
              post_id:        postId,
              status:         'pending',
              trigger_reason: `visual_hard_block:${vqc.violations.join(',')}`,
              cco_score:      null,
              visual_score:   vqc.visual_score,
              visual_issues:  vqc.visual_issues ?? [],
              flags: {
                negpat_flag:     'HARD_BLOCK',
                visual_hard_block: true,
                violations:      vqc.violations,
              },
            } as never, { onConflict: 'post_id', ignoreDuplicates: true })
          } catch { /* non-fatal */ }
        }
      }
    }

    const alert_admin = shouldAlertAdmin(overrides)

    // ── Per-post composite score summary for N8N ─────────────────────────
    // N8N uses this to set routing on each post and to write visual_score to
    // the qa_review_queue rows it creates for held posts.
    const post_scores = input.payload.cco_results.map((cco) => {
      const scored = compositeByPost.get(cco.post_id)!
      const vqc    = visualByPost.get(cco.post_id)
      return {
        post_id:          cco.post_id,
        confidence_score: scored.composite,
        visual_score:     vqc?.visual_score ?? null,
        route:            scored.route,
        hard_blocked:     scored.hard_blocked,
        pillars:          scored.pillars,
        visual_issues:    vqc?.visual_issues ?? [],
      }
    })

    return {
      decision,
      human_overrides: {
        per_post: overrides.per_post,
        calendar_reasons: overrides.calendar_reasons,
        alert_admin,
      },
      // Composite score details per post — N8N must write these to qa_review_queue rows
      post_scores,
      memory: { enqueued: nominations_enqueued, dropped: nominations_dropped },
    }
  },
})
