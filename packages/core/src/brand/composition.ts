/**
 * Composition Matrix — pure-JS scoring + composition logic.
 *
 * Mirrors the SQL `composition_matrix` table (WIDE FORMAT — one row per
 * tuple with 6 method-score columns + recommended_method + hybrid_composition).
 *
 * Two public functions:
 *   • scoreMethodsForTuple(tuple, seededRow?) — returns Record<method, score>
 *   • decideComposition(scores) — picks single winner OR composes a hybrid
 */
import { type Archetype, ARCHETYPE_DEFINITIONS } from './archetypes'
import { type LifecycleStage } from './lifecycle'
import { type IntentState } from './intent'
import {
  type CreativeMethod,
  CREATIVE_METHODS,
  type MethodComponentSlot,
} from './method-anatomy'

export interface CompositionTuple {
  archetype: Archetype
  lifecycle_stage: LifecycleStage
  intent_state: IntentState
}

/**
 * Wide-format row shape — mirrors the public.composition_matrix table.
 * One row per (archetype × lifecycle × intent) tuple.
 */
export interface MatrixRow {
  archetype: Archetype
  lifecycle_stage: LifecycleStage
  intent_state: IntentState
  diagnostic_score: number
  metaphor_score: number
  paradox_score: number
  authenticity_score: number
  heritage_score: number
  vulnerability_score: number
  recommended_method: CreativeMethod | null
  is_hybrid_recommended: boolean
  hybrid_composition: HybridComposition | null
}

export interface HybridComposition {
  top_3: Array<{ method: CreativeMethod; score: number }>
}

/**
 * The score above which a single method "wins" outright.
 * Below this threshold, we compose a hybrid from multiple methods.
 * Per framework v2: 80 is the documented top-of-cleanly-covered band.
 * Mirrored in the SQL `recommended_method` derivation in migration 0024.
 */
export const SINGLE_METHOD_THRESHOLD = 80

/**
 * Minimum acceptable composition score (average of winning components).
 * Below this, the brand is flagged for human review.
 */
export const COMPOSITION_FLOOR = 60

/**
 * Score every method for a tuple. Uses the wide-format MatrixRow when
 * provided; falls back to a heuristic formula based on archetype default-
 * method affinities + lifecycle/intent biases.
 */
export function scoreMethodsForTuple(
  tuple: CompositionTuple,
  seededRow?: MatrixRow | null,
): Record<CreativeMethod, number> {
  if (
    seededRow &&
    seededRow.archetype === tuple.archetype &&
    seededRow.lifecycle_stage === tuple.lifecycle_stage &&
    seededRow.intent_state === tuple.intent_state
  ) {
    return {
      Diagnostic:    seededRow.diagnostic_score,
      Metaphor:      seededRow.metaphor_score,
      Paradox:       seededRow.paradox_score,
      Authenticity:  seededRow.authenticity_score,
      Heritage:      seededRow.heritage_score,
      Vulnerability: seededRow.vulnerability_score,
    }
  }

  const result = {} as Record<CreativeMethod, number>
  for (const method of CREATIVE_METHODS) {
    result[method] = fallbackScore(tuple, method)
  }
  return result
}

/**
 * Heuristic fallback score for a (tuple, method) pair when not seeded.
 * Combines: (a) archetype default-method affinity, (b) lifecycle bias,
 * (c) intent bias.
 *
 * Mirrors the SQL CASE expressions in migration 0024 phase H so JS and SQL
 * agree when the matrix is missing a row.
 */
function fallbackScore(t: CompositionTuple, method: CreativeMethod): number {
  let score = 50 // neutral baseline

  // Archetype affinity — defaults from ARCHETYPE_DEFINITIONS
  const archDef = ARCHETYPE_DEFINITIONS[t.archetype]
  if (archDef.default_methods.includes(method)) score += 25

  // Lifecycle bias
  if (t.lifecycle_stage === 'pre_launch') {
    if (method === 'Diagnostic') score += 25 // upstream-only — pre_launch's documented best fit
    if (method === 'Metaphor') score -= 15
    if (method === 'Heritage') score -= 20 // no heritage to claim yet
  }
  if (t.lifecycle_stage === 'launch') {
    if (method === 'Vulnerability') score += 15
    if (method === 'Authenticity') score += 8
    if (method === 'Heritage') score -= 15
  }
  if (t.lifecycle_stage === 'maturity') {
    if (method === 'Heritage') score += 10
    if (method === 'Vulnerability' && (t.archetype === 'Sage' || t.archetype === 'Ruler')) score -= 25
  }
  if (t.lifecycle_stage === 'recovery') {
    if (method === 'Vulnerability') score += 12
    if (method === 'Authenticity') score += 8
    if (method === 'Paradox') score += 10
  }

  // Intent bias
  if (t.intent_state === 'launch' && method === 'Authenticity') score += 8
  if (t.intent_state === 'harvest' && method === 'Diagnostic') score += 10
  if (t.intent_state === 'defend' && method === 'Heritage') score += 8
  if (t.intent_state === 'recover' && method === 'Vulnerability') score += 12
  if (t.intent_state === 'grow' && method === 'Paradox') score += 5

  return Math.max(0, Math.min(100, score))
}

/**
 * Decide whether one method wins outright or we need composition.
 * Returns:
 *   • { mode: 'single', method, score } when one method clears the threshold
 *   • { mode: 'compose', blend, score } when components are sourced from
 *     multiple methods. blend maps each component slot → winning method.
 */
export interface CompositionDecision {
  mode: 'single' | 'compose'
  primary_method: CreativeMethod
  blend: Partial<Record<MethodComponentSlot, CreativeMethod>>
  score: number
  needs_review: boolean
}

export function decideComposition(
  scores: Record<CreativeMethod, number>,
): CompositionDecision {
  const sorted = (Object.entries(scores) as [CreativeMethod, number][]).sort(
    (a, b) => b[1] - a[1],
  )
  const [topMethod, topScore] = sorted[0]!
  const [secondMethod, secondScore] = sorted[1]!

  // Single-method win
  if (topScore >= SINGLE_METHOD_THRESHOLD) {
    return {
      mode: 'single',
      primary_method: topMethod,
      blend: {
        voice: topMethod,
        diagnostic: topMethod,
        visual: topMethod,
        cadence: topMethod,
        closing: topMethod,
      },
      score: topScore,
      needs_review: topScore < COMPOSITION_FLOOR,
    }
  }

  // Compose: top method wins voice + diagnostic; second wins one of visual/cadence/closing
  const blend: Partial<Record<MethodComponentSlot, CreativeMethod>> = {
    voice: topMethod,
    diagnostic: topMethod,
    visual: secondMethod,
    cadence: topMethod,
    closing: secondScore >= 50 ? secondMethod : topMethod,
  }
  const counts = countBlendMethods(blend)
  let weighted = 0
  let total = 0
  for (const [m, c] of Object.entries(counts)) {
    weighted += (scores[m as CreativeMethod] ?? 0) * c
    total += c
  }
  const score = total > 0 ? Math.round(weighted / total) : topScore

  return {
    mode: 'compose',
    primary_method: topMethod,
    blend,
    score,
    needs_review: score < COMPOSITION_FLOOR,
  }
}

function countBlendMethods(
  blend: Partial<Record<MethodComponentSlot, CreativeMethod>>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of Object.values(blend)) {
    if (!v) continue
    out[v] = (out[v] ?? 0) + 1
  }
  return out
}
