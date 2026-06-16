/**
 * Single source of truth for CCO score → band thresholds.
 *
 * The CCO produces one 0–100 `cco_score`. That score maps to a band that drives
 * the route decision and the QA UI's colour/label everywhere:
 *
 *   score ≥ CLEAN_MIN (75)              → CLEAN     (publishable, no watermark)
 *   MARK_MIN (50) ≤ score < CLEAN_MIN   → MARK      (watermarked, sent for review)
 *   score < MARK_MIN                    → HOLD      (held for a human decision)
 *
 * Before this module the 75/50 literals were copy-pasted across 9 UI files plus
 * a divergent n8n value, with no way to change the policy without hunting them
 * down. Import `SCORE_BANDS` / `scoreBand()` instead of hardcoding the numbers.
 *
 * NOTE: n8n flows (A01 Skeleton Builder, V01-Worker) run in their own JS sandbox
 * and cannot import this package. They MUST mirror these values — see the
 * `holdThreshold` constant in the A01 Skeleton Builder. If you change a
 * threshold here, update the n8n flows in the same commit.
 */

export const SCORE_BANDS = {
  /** Minimum score to be CLEAN (publishable without watermark). */
  CLEAN_MIN: 75,
  /** Minimum score to be MARK (watermarked); below this is HOLD. */
  MARK_MIN: 50,
} as const

export type ScoreBand = 'clean' | 'mark' | 'hold'

/** Map a raw 0–100 score (or null/undefined) to its band. Null → 'hold'. */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (typeof score !== 'number') return 'hold'
  if (score >= SCORE_BANDS.CLEAN_MIN) return 'clean'
  if (score >= SCORE_BANDS.MARK_MIN) return 'mark'
  return 'hold'
}

/** Uppercase label for a band — CLEAN / MARK / HOLD. */
export function scoreBandLabel(score: number | null | undefined): 'CLEAN' | 'MARK' | 'HOLD' {
  return scoreBand(score).toUpperCase() as 'CLEAN' | 'MARK' | 'HOLD'
}
