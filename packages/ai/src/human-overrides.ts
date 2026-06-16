/**
 * The 11 Human Override Triggers (Doc §6.4) — DETERMINISTIC, no LLM.
 *
 * The CEO LLM is asked to set human_gate_required, but a safety-critical
 * compliance gate must NOT depend on a model remembering 11 rules. This module
 * encodes them as pure, testable code and is run AFTER the CEO call to
 * post-process its decision: any trigger the LLM missed is forced here.
 *
 * POLICY (June 2026 — Point 1): a fired trigger NEVER blocks generation. The
 * image is always generated so the Admin (the "human review" in the doc) can see
 * the real visual in /admin/qa. A trigger only HOLDS the post from CLIENT
 * delivery and routes it to the Admin QA queue with the exact reasons. "No
 * delivery" = no delivery to the client, not "no generation".
 *
 * Each trigger maps a doc condition to an action over a scope:
 *   - hold_all   : every post in the calendar is held (triggers 1, 5, 8)
 *   - hold_post  : this specific post is held       (triggers 2,3,4,6,7,9,10,11)
 */

/** Per-post evaluation the CCO returned (subset we gate on). */
export interface OverridePost {
  post_id: string
  score: number
  brave_route_flag: boolean
  negpat_flag: 'NONE' | 'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK' | string
  cultural_flag?: boolean
  dialect_flag?: boolean
  /** CCO controlled-vocab issue tags (e.g. 'religious_reference_uncleared', 'price_claim_prohibited'). */
  issues?: string[]
  /** Content type from DeepSeek/plan-slots (e.g. 'educational', 'testimonial', 'emotional'). */
  content_type?: string
  /** Hero content = the calendar's flagship posts. We treat the first N slots as hero (doc §6.4 #7). */
  is_hero?: boolean
  /** Revision count for this post_id (doc §6.4 #9). */
  revision_count?: number
}

/** Brand/calendar-level context the triggers read. */
export interface OverrideContext {
  sector: string | null
  religious_sensitivity: string | null      // 'High' | 'Medium' | 'Low'
  total_calendars_generated: number          // 0 = first-ever client
  dialect_confidence: string | null          // 'inferred_low' = trigger 7
  has_unresolved_conflict: boolean           // trigger 8 (best-effort; false when source missing)
}

/** One fired trigger, recorded per post for the audit + QA UI. */
export interface FiredTrigger {
  trigger: number          // 1..11
  reason: string           // machine code, e.g. 'first_ever_client'
  detail: string           // human sentence for the Admin QA UI
}

export interface OverrideResult {
  /** post_id -> the triggers that held it (empty array = not held). */
  per_post: Record<string, FiredTrigger[]>
  /** True if ANY post is held — sets RoutingDecision.human_gate_required. */
  human_gate_required: boolean
  /** Calendar-level reasons (hold_all triggers). */
  calendar_reasons: FiredTrigger[]
}

const HERO_SLOT_COUNT = 3 // doc §6.4 #7: "hero content" = the flagship slots

const isHealthcare = (s: string | null) => (s ?? '').toLowerCase().includes('health')
const isFinance    = (s: string | null) => {
  const x = (s ?? '').toLowerCase()
  return x.includes('financ') || x.includes('fintech') || x.includes('invest') || x.includes('bank')
}
const isGovernment = (s: string | null) => (s ?? '').toLowerCase().includes('government')

/**
 * Evaluate all 11 triggers over the calendar's posts.
 * Pure function — no I/O. Caller supplies the resolved context + posts.
 */
export function applyHumanOverrides(
  ctx: OverrideContext,
  posts: OverridePost[],
): OverrideResult {
  const per_post: Record<string, FiredTrigger[]> = {}
  const calendar_reasons: FiredTrigger[] = []
  for (const p of posts) per_post[p.post_id] = []

  const holdAll = (t: FiredTrigger) => {
    calendar_reasons.push(t)
    for (const p of posts) per_post[p.post_id]!.push(t)
  }
  const holdPost = (post_id: string, t: FiredTrigger) => {
    ;(per_post[post_id] ??= []).push(t)
  }

  // ── Trigger 1 — First-ever output for new client → HOLD ALL ────────────────
  if (ctx.total_calendars_generated === 0) {
    holdAll({
      trigger: 1, reason: 'first_ever_client_output',
      detail: 'First-ever calendar for this brand — all posts held for admin review regardless of score.',
    })
  }

  // ── Trigger 5 — Government sector (always) → HOLD ALL ───────────────────────
  if (isGovernment(ctx.sector)) {
    holdAll({
      trigger: 5, reason: 'government_sector',
      detail: 'Government sector — all posts always held for admin review.',
    })
  }

  // ── Trigger 8 — Unresolved conflict record on a critical field → HOLD ALL ───
  if (ctx.has_unresolved_conflict) {
    holdAll({
      trigger: 8, reason: 'unresolved_conflict_record',
      detail: 'Unresolved BrandDNA conflict on a critical field — all posts held until resolved.',
    })
  }

  // ── Per-post triggers (2,3,4,6,7,9,10,11) ──────────────────────────────────
  const healthcare = isHealthcare(ctx.sector)
  const finance    = isFinance(ctx.sector)
  const highReligious = (ctx.religious_sensitivity ?? '') === 'High'
  const dialectLow    = ctx.dialect_confidence === 'inferred_low'

  for (const p of posts) {
    const issues = (p.issues ?? []).map((i) => String(i).toLowerCase())
    const ct = (p.content_type ?? '').toLowerCase()

    // Trigger 2 — brave_route on any post → hold THAT flagged post
    if (p.brave_route_flag === true) {
      holdPost(p.post_id, {
        trigger: 2, reason: 'brave_route_flagged',
        detail: 'CCO took a creative risk (brave_route) — held for admin review.',
      })
    }

    // Trigger 3 — Healthcare + health claim (educational OR testimonial) → hold
    if (healthcare && (ct === 'educational' || ct === 'testimonial')) {
      holdPost(p.post_id, {
        trigger: 3, reason: 'healthcare_health_claim',
        detail: `Healthcare sector + ${ct} content (potential health claim) — held for admin review.`,
      })
    }

    // Trigger 4 — Finance + prohibited claim detected by CCO → hold
    if (finance && (issues.includes('price_claim_prohibited') || p.negpat_flag === 'HARD_BLOCK')) {
      holdPost(p.post_id, {
        trigger: 4, reason: 'finance_investment_claim',
        detail: 'Finance sector + prohibited/investment claim flagged by CCO — held for admin review.',
      })
    }

    // Trigger 6 — High religious sensitivity + religious reference flagged → hold
    if (highReligious && (issues.includes('religious_reference_uncleared') || p.cultural_flag === true)) {
      holdPost(p.post_id, {
        trigger: 6, reason: 'religious_reference_high_sensitivity',
        detail: 'High religious-sensitivity brand + religious reference flagged by CCO — held for admin review.',
      })
    }

    // Trigger 7 — Dialect inferred_low on HERO content → hold hero post
    if (dialectLow && p.is_hero === true) {
      holdPost(p.post_id, {
        trigger: 7, reason: 'dialect_unconfirmed_hero',
        detail: 'Brand dialect confidence is inferred_low and this is hero content — held for admin review.',
      })
    }

    // Trigger 9 — Third revision of same output → hold this post
    if ((p.revision_count ?? 0) >= 3) {
      holdPost(p.post_id, {
        trigger: 9, reason: 'revision_cycle_exceeded',
        detail: `Post reached revision #${p.revision_count} — held for admin review.`,
      })
    }

    // Trigger 10 — Any CCO score below 50 → hold this post
    if (p.score < 50) {
      holdPost(p.post_id, {
        trigger: 10, reason: 'cco_low_confidence',
        detail: `CCO score ${p.score} is below 50 — held for admin review.`,
      })
    }

    // Trigger 11 — HARD_BLOCK NegativePattern fired → hold this post + alert admin
    if (p.negpat_flag === 'HARD_BLOCK') {
      holdPost(p.post_id, {
        trigger: 11, reason: 'hard_block_negative_pattern',
        detail: 'HARD_BLOCK negative pattern fired — held for admin review (admin alerted).',
      })
    }
  }

  const human_gate_required = Object.values(per_post).some((arr) => arr.length > 0)
  return { per_post, human_gate_required, calendar_reasons }
}

/** True if trigger 11 fired anywhere — caller should alert the admin (doc §6.4 #11). */
export function shouldAlertAdmin(result: OverrideResult): boolean {
  return Object.values(result.per_post).some((arr) => arr.some((t) => t.trigger === 11))
}
