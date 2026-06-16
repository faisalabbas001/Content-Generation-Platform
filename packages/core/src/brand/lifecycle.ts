/**
 * Lifecycle stages (Doc framework v2 § Axis 2).
 *
 * Each stage carries a distinct voice modulation and vulnerability
 * permission level — independent of archetype. Mirrors the
 * `lifecycle_stage_type` Postgres enum (snake_case lowercase per
 * the canonical framework spec).
 */

export const LIFECYCLE_STAGES = [
  'pre_launch',
  'launch',
  'growth',
  'maturity',
  'recovery',
] as const

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]

export function isLifecycleStage(value: unknown): value is LifecycleStage {
  return typeof value === 'string' && (LIFECYCLE_STAGES as readonly string[]).includes(value)
}

/**
 * Human-readable labels per lifecycle stage. Use these in UI surfaces
 * (review form summary, brand-direction-card, snapshot UI) — never
 * render the raw enum value to users.
 */
export const LIFECYCLE_LABELS: Record<LifecycleStage, { en: string; ar: string }> = {
  pre_launch: { en: 'Pre-Launch', ar: 'ما قبل الإطلاق' },
  launch:     { en: 'Launch',     ar: 'الإطلاق' },
  growth:     { en: 'Growth',     ar: 'النمو' },
  maturity:   { en: 'Maturity',   ar: 'النضج' },
  recovery:   { en: 'Recovery',   ar: 'التعافي' },
}

/**
 * Detection rules — heuristics for inferring stage from observable signals.
 * Used by the COO prompt and as a fallback when COO cannot decide.
 *
 * Inputs the prompt has access to:
 *   • account_age_months — from Apify or domain WHOIS
 *   • post_count — total posts seen
 *   • post_frequency_30d — posts in the last 30 days
 *   • follower_growth_pct_30d — change in follower count
 *   • rebrand_signals — handle changes, name changes, gap in posting
 */
export interface LifecycleSignals {
  account_age_months: number | null
  post_count: number | null
  post_frequency_30d: number | null
  follower_growth_pct_30d: number | null
  rebrand_signals: boolean
  recent_long_gap: boolean
}

/**
 * Pure JS heuristic — used as a fallback if COO can't decide. The COO prompt
 * encodes richer rules but should agree with this for the obvious cases.
 *
 * Returns null if signals are insufficient to make a confident call —
 * caller defaults to 'launch' (safest assumption — most SMEs onboard at launch)
 * and marks confidence as inferred_low.
 */
export function inferLifecycleStage(s: LifecycleSignals): LifecycleStage | null {
  // Recent rebrand or long gap → recovery (per doc: "post-crisis comeback")
  if (s.rebrand_signals) return 'recovery'
  if (s.recent_long_gap && (s.account_age_months ?? 0) >= 24) return 'recovery'

  const age = s.account_age_months ?? 0
  const posts = s.post_count ?? 0
  const freq = s.post_frequency_30d ?? 0

  // Pre-Launch: brand still being built. No public footprint yet.
  if (age === 0 && posts === 0) return 'pre_launch'

  // Launch: very young or very few posts (0-12 months per doc)
  if (age < 12 || posts < 30) return 'launch'

  // Growth: 12-36 months, accelerating cadence, healthy follower growth
  if (age <= 36 && freq >= 8 && (s.follower_growth_pct_30d ?? 0) >= 5) return 'growth'

  // Maturity: 3+ years, steady cadence
  if (age >= 36 && freq >= 4) return 'maturity'

  return null
}
