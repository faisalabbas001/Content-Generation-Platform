// Scoring aggregate — runs all 5 scorers in parallel and computes overall score.

import { scorePostingConsistency } from './scorer-consistency'
import { scoreEngagementHealth }   from './scorer-engagement'
import { scoreCulturalFit }        from './scorer-cultural'
import { scoreVisualQuality }      from './scorer-visual'
import { scoreBrandCoherence }     from './scorer-coherence'
import { DIMENSION_WEIGHTS, scoreTier } from './types'
import type { ScoringInput, ScoringOutput, DimensionResult } from './types'

export async function runScoring(input: ScoringInput): Promise<ScoringOutput> {
  // All 5 scorers run in parallel
  const safeSync = <T,>(fn: () => T, fb: T): T => { try { return fn() } catch { return fb } }
  const safeAsync = <T,>(p: Promise<T>, fb: T): Promise<T> => p.catch(() => fb)

  // Cultural fit runs in parallel with non-vision scorers (uses DeepSeek, not Haiku).
  // VQ and BC both use Claude Haiku Vision — run them sequentially to avoid 529 overloads.
  const [culturalBundle, visualResult] = await Promise.all([
    safeAsync(scoreCulturalFit(input), { result: fallback('cultural_fit'), deepDive: emptyDeepDive() }),
    safeAsync(scoreVisualQuality(input), fallback('visual_quality')),
  ])
  const coherenceResult = await safeAsync(scoreBrandCoherence(input), fallback('brand_coherence'))

  const consistencyResult = safeSync(() => scorePostingConsistency(input), fallback('posting_consistency'))
  const engagementResult  = safeSync(() => scoreEngagementHealth(input), fallback('engagement_health'))

  const dimensions: DimensionResult[] = [
    consistencyResult,
    engagementResult,
    culturalBundle.result,
    visualResult,
    coherenceResult,
  ]

  // Weighted sum — formula from spec §6
  const overall_score = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * DIMENSION_WEIGHTS[d.dimension], 0),
  )

  return {
    dimensions,
    overall_score,
    tier: scoreTier(overall_score),
    cultural_deepdive: culturalBundle.deepDive,
  }
}

function fallback(dimension: DimensionResult['dimension']): DimensionResult {
  return {
    dimension,
    score: 0,
    weight: DIMENSION_WEIGHTS[dimension],
    benchmark: null,
    submetrics: { error: 'scorer_failed' },
    findings: [{
      finding_en: 'Analysis unavailable for this dimension.',
      finding_ar: 'التحليل غير متاح لهذا البُعد.',
      evidence_count: null,
      evidence_total: null,
      benchmark_count: null,
      severity: 'mid',
    }],
    action: {
      workflow_id: 'support',
      action_label_en: 'Contact support',
      action_label_ar: 'تواصل مع الدعم',
      estimated_lift: 0,
      timeframe_weeks: 0,
      icon_emoji: '⚠️',
    },
  }
}

function emptyDeepDive() {
  return {
    language_breakdown: {},
    occasions: [],
    dialect_multiplier: null,
    dialect_multiplier_note_en: 'Analysis unavailable',
    dialect_multiplier_note_ar: 'التحليل غير متاح',
  }
}
