/**
 * Calendar Engine — Occasion Logic (Phase 0, spec §5.2 + §9.2)
 *
 * Deterministic spine component. No LLM. Computes:
 *   1. Phase-adjusted content mix for each occasion (Ramadan 3-phase,
 *      National Day 2-week build, Eid peak/tail)
 *   2. Goal-phase modifier applied on top of occasion mix
 *   3. Occasion phase classification (pre / active / peak / winding_down)
 *   4. Content frequency multiplier for occasion windows
 *
 * Called by COO compile-caption-context route before passing context to COO.
 * COO receives the adjusted mix — it never runs this logic itself.
 */

export type ContentMix = Record<string, number>

export type OccasionPhase =
  | 'pre_arrival'      // > lead_weeks before gregorian_date
  | 'build_up'         // 1-2 weeks before
  | 'active'           // gregorian_date window (duration varies per occasion)
  | 'peak'             // highest-intensity window within active
  | 'winding_down'     // post-peak tail
  | 'outside'          // not in any window

export interface OccasionContext {
  occasion_key:         string
  occasion_name_ar:     string
  gregorian_date:       string       // ISO date of occasion start
  lead_weeks:           number
  base_mix:             ContentMix   // from occasion_intelligence.recommended_mix
  sector_applicability: Record<string, boolean>
}

export interface AdjustedOccasion {
  occasion_key:     string
  phase:            OccasionPhase
  days_until:       number          // negative = days since start
  adjusted_mix:     ContentMix
  frequency_boost:  number          // multiply posts/week by this factor
  register_shift:   string | null   // e.g. 'spiritual_warmth' for Ramadan peak
  is_active:        boolean
}

// ── Phase boundaries per occasion (days relative to gregorian_date) ──────────

const PHASE_CONFIG: Record<string, {
  pre_arrival_days: number   // > N days before = pre_arrival
  build_up_days:   number    // N..1 days before = build_up
  active_days:     number    // 0..N days after = active
  peak_days:       number    // 0..N days after = peak (subset of active)
  tail_days:       number    // active_days..tail_days after = winding_down
}> = {
  ramadan: {
    pre_arrival_days: 28,    // 4 weeks lead-up
    build_up_days:    14,    // 2-week spiritual build
    active_days:      30,    // full month active
    peak_days:        20,    // first 20 days = peak
    tail_days:        10,    // final 10 days + 3 days post = wind-down
  },
  eid_fitr: {
    pre_arrival_days: 14,
    build_up_days:     7,
    active_days:       3,    // 3-day Eid peak
    peak_days:         1,
    tail_days:         7,    // 1-week tail
  },
  eid_adha: {
    pre_arrival_days: 14,
    build_up_days:     7,
    active_days:       3,
    peak_days:         1,
    tail_days:         7,
  },
  national_day: {
    pre_arrival_days: 21,    // 3-week awareness
    build_up_days:    14,    // 2-week build (spec §5.2 explicitly)
    active_days:       1,    // day-of peak
    peak_days:         1,
    tail_days:         3,    // 3-day tail (spec §5.2)
  },
  founding_day: {
    pre_arrival_days: 14,
    build_up_days:     7,
    active_days:       1,
    peak_days:         1,
    tail_days:         3,
  },
}

// ── Occasion-phase content mixes ──────────────────────────────────────────────
// Overrides the base_mix from occasion_intelligence per phase.
// Numbers are proportions (sum to ~1.0). Base_mix used when no override.

const RAMADAN_PHASE_MIXES: Record<string, ContentMix> = {
  pre_arrival:  { emotional: 0.50, lifestyle: 0.30, offer: 0.10, brand_story: 0.10 },
  build_up:     { emotional: 0.60, lifestyle: 0.25, offer: 0.10, brand_story: 0.05 },
  active:       { emotional: 0.55, lifestyle: 0.30, offer: 0.10, brand_story: 0.05 },  // default base_mix
  peak:         { emotional: 0.65, lifestyle: 0.25, offer: 0.05, brand_story: 0.05 },
  winding_down: { emotional: 0.40, lifestyle: 0.35, offer: 0.20, brand_story: 0.05 },
}

const NATIONAL_DAY_PHASE_MIXES: Record<string, ContentMix> = {
  pre_arrival:  { brand_story: 0.30, lifestyle: 0.30, occasion: 0.25, product: 0.15 },
  build_up:     { occasion: 0.45, brand_story: 0.25, lifestyle: 0.20, product: 0.10 },
  active:       { occasion: 0.70, brand_story: 0.20, lifestyle: 0.10 },
  peak:         { occasion: 0.80, brand_story: 0.15, lifestyle: 0.05 },
  winding_down: { brand_story: 0.40, lifestyle: 0.35, occasion: 0.15, product: 0.10 },
}

const EID_PHASE_MIXES: Record<string, ContentMix> = {
  pre_arrival:  { occasion: 0.30, lifestyle: 0.30, product: 0.25, brand_story: 0.15 },
  build_up:     { occasion: 0.50, lifestyle: 0.25, product: 0.20, brand_story: 0.05 },
  active:       { occasion: 0.65, lifestyle: 0.20, product: 0.10, brand_story: 0.05 },
  peak:         { occasion: 0.75, lifestyle: 0.15, product: 0.10 },
  winding_down: { lifestyle: 0.40, product: 0.30, brand_story: 0.20, occasion: 0.10 },
}

const OCCASION_MIXES: Record<string, Record<string, ContentMix>> = {
  ramadan:      RAMADAN_PHASE_MIXES,
  eid_fitr:     EID_PHASE_MIXES,
  eid_adha:     EID_PHASE_MIXES,
  national_day: NATIONAL_DAY_PHASE_MIXES,
  founding_day: NATIONAL_DAY_PHASE_MIXES,
}

// Register shifts per phase — passed to COO as tone guidance
const REGISTER_SHIFTS: Record<string, Record<string, string | null>> = {
  ramadan: {
    pre_arrival:  'warm_anticipation',
    build_up:     'spiritual_warmth',
    active:       'spiritual_warmth',
    peak:         'spiritual_peak',
    winding_down: 'gentle_celebration',
  },
  national_day: {
    pre_arrival:  null,
    build_up:     'national_pride_building',
    active:       'national_pride_peak',
    peak:         'national_pride_peak',
    winding_down: 'pride_reflection',
  },
}

// ── Goal-phase modifiers ──────────────────────────────────────────────────────
// Applied on top of the occasion-adjusted mix. Proportional nudge only —
// never overrides occasion logic entirely.

const GOAL_PHASE_MODIFIERS: Record<string, (mix: ContentMix) => ContentMix> = {
  awareness:  (m) => ({ ...m, brand_story: (m.brand_story ?? 0) * 1.2, emotional: (m.emotional ?? 0) * 1.1 }),
  conversion: (m) => ({ ...m, offer: (m.offer ?? 0) * 1.3, product: (m.product ?? 0) * 1.2 }),
  retention:  (m) => ({ ...m, lifestyle: (m.lifestyle ?? 0) * 1.2, brand_story: (m.brand_story ?? 0) * 1.1 }),
  launch:     (m) => ({ ...m, brand_story: (m.brand_story ?? 0) * 1.4, occasion: (m.occasion ?? 0) * 1.1 }),
}

// ── Frequency boost per phase ────────────────────────────────────────────────

const FREQUENCY_BOOSTS: Record<string, Record<string, number>> = {
  ramadan:      { pre_arrival: 1.2, build_up: 1.5, active: 1.3, peak: 1.3, winding_down: 1.0 },
  eid_fitr:     { pre_arrival: 1.2, build_up: 1.5, active: 2.0, peak: 2.0, winding_down: 1.2 },
  eid_adha:     { pre_arrival: 1.2, build_up: 1.5, active: 2.0, peak: 2.0, winding_down: 1.2 },
  national_day: { pre_arrival: 1.0, build_up: 1.3, active: 1.8, peak: 1.8, winding_down: 1.0 },
  founding_day: { pre_arrival: 1.0, build_up: 1.2, active: 1.5, peak: 1.5, winding_down: 1.0 },
}

// ── Core computation ──────────────────────────────────────────────────────────

function normaliseMix(mix: ContentMix): ContentMix {
  const total = Object.values(mix).reduce((s, v) => s + v, 0)
  if (total === 0) return mix
  return Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Math.round((v / total) * 100) / 100]))
}

function getOccasionPhase(
  occasionKey: string,
  daysUntil: number,
): OccasionPhase {
  const cfg = PHASE_CONFIG[occasionKey]
  if (!cfg) return 'outside'

  if (daysUntil > cfg.pre_arrival_days)  return 'outside'
  if (daysUntil > cfg.build_up_days)     return 'pre_arrival'
  if (daysUntil > 0)                     return 'build_up'
  if (daysUntil >= -cfg.peak_days)       return 'peak'
  if (daysUntil >= -cfg.active_days)     return 'active'
  if (daysUntil >= -cfg.tail_days)       return 'winding_down'
  return 'outside'
}

/**
 * Main entry point. Called by COO route for each active occasion.
 * Returns phase-aware, goal-phase-adjusted content mix + metadata.
 */
export function computeAdjustedOccasion(
  occasion:    OccasionContext,
  currentDate: Date,
  goalPhase:   string | null = null,
): AdjustedOccasion {
  const occasionStart = new Date(occasion.gregorian_date)
  const msPerDay      = 1000 * 60 * 60 * 24
  const daysUntil     = Math.ceil((occasionStart.getTime() - currentDate.getTime()) / msPerDay)
  const phase         = getOccasionPhase(occasion.occasion_key, daysUntil)
  const isActive      = phase !== 'outside'

  // 1. Start with base mix from DB
  let mix: ContentMix = { ...occasion.base_mix }

  // 2. Apply occasion-phase override
  const phaseMixes = OCCASION_MIXES[occasion.occasion_key]
  if (phaseMixes?.[phase]) {
    mix = { ...phaseMixes[phase]! }
  }

  // 3. Apply goal-phase modifier
  const modifier = goalPhase ? GOAL_PHASE_MODIFIERS[goalPhase] : null
  if (modifier) mix = modifier(mix)

  // 4. Normalise to sum to 1.0
  mix = normaliseMix(mix)

  // 5. Frequency boost
  const frequencyBoost = FREQUENCY_BOOSTS[occasion.occasion_key]?.[phase] ?? 1.0

  // 6. Register shift
  const registerShift = REGISTER_SHIFTS[occasion.occasion_key]?.[phase] ?? null

  return {
    occasion_key:    occasion.occasion_key,
    phase,
    days_until:      daysUntil,
    adjusted_mix:    mix,
    frequency_boost: frequencyBoost,
    register_shift:  registerShift,
    is_active:       isActive,
  }
}

/**
 * Process all occasions for a brand. Returns only active ones (not 'outside').
 * Highest-priority active occasion is returned first.
 */
export function computeActiveOccasions(
  occasions:   OccasionContext[],
  currentDate: Date,
  goalPhase:   string | null = null,
  sector:      string | null = null,
): AdjustedOccasion[] {
  return occasions
    .filter((o) => !sector || o.sector_applicability[sector] !== false)
    .map((o) => computeAdjustedOccasion(o, currentDate, goalPhase))
    .filter((o) => o.is_active)
    .sort((a, b) => {
      // Closer occasions first; peaks before build-ups
      const phaseOrder: Record<OccasionPhase, number> = {
        peak: 0, active: 1, winding_down: 2, build_up: 3, pre_arrival: 4, outside: 5,
      }
      const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase]
      if (phaseDiff !== 0) return phaseDiff
      return Math.abs(a.days_until) - Math.abs(b.days_until)
    })
}

/**
 * Get the dominant mix to use for a calendar slot.
 * If an active occasion is present, returns its adjusted mix blended with the
 * brand's base content mix (weighted 70% occasion, 30% base).
 * If no active occasion, returns the brand's base mix unchanged.
 */
export function getDominantContentMix(
  brandBaseMix:      ContentMix,
  activeOccasions:   AdjustedOccasion[],
  occasionWeight = 0.70,
): ContentMix {
  if (activeOccasions.length === 0) return brandBaseMix

  const dominant = activeOccasions[0]!
  const blended: ContentMix = {}
  const allKeys = new Set([
    ...Object.keys(brandBaseMix),
    ...Object.keys(dominant.adjusted_mix),
  ])

  for (const k of allKeys) {
    const baseVal     = brandBaseMix[k]     ?? 0
    const occasionVal = dominant.adjusted_mix[k] ?? 0
    blended[k] = occasionVal * occasionWeight + baseVal * (1 - occasionWeight)
  }

  return normaliseMix(blended)
}
