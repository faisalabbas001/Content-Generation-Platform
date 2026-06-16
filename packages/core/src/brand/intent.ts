/**
 * Intent state (Doc framework v2 § Axis 3).
 *
 * "The most fluid axis" — a brand can shift intent month to month while
 * archetype and stage remain stable. Each intent governs a chain-mix.
 *
 * Mirrors the `intent_state_type` Postgres enum (lowercase verb form per
 * canonical framework spec).
 */

export const INTENT_STATES = [
  'launch',
  'grow',
  'defend',
  'harvest',
  'recover',
] as const

export type IntentState = (typeof INTENT_STATES)[number]

export function isIntentState(value: unknown): value is IntentState {
  return typeof value === 'string' && (INTENT_STATES as readonly string[]).includes(value)
}

/**
 * Chain-mix per intent — what proportion of a calendar's posts fall into
 * each chain category. Used by the calendar generator (N8N-A01) and shown
 * in the snapshot UI so users understand what the system is producing.
 *
 * Percentages must sum to 100. Validated at module load.
 *
 * Values come from the canonical doc (Axis 3 — Intent State table):
 *   • launch  — "Establish that you exist and matter"
 *               30% brand_story / 35% product / 15% discovery / 10% conversion / 10% engagement
 *   • grow    — "Expand reach beyond current audience"
 *               40% product crave / 25% brand-lifestyle / 15% promotional / 15% occasion / 5% new
 *   • defend  — "Protect position from competitive pressure"
 *               30% differentiator / 25% loyalty-proof / 20% product hero / 15% occasion / 10% conversion
 *   • harvest — "Convert engaged audience into revenue"
 *               40% product / 25% conversion / 20% promotional / 10% occasion / 5% loyalty
 *   • recover — "Re-engage after dormancy or crisis"
 *               35% renewed identity / 25% testimonial-proof / 20% behind-the-scenes / 10% comeback / 10% occasion
 */
export interface ChainMix {
  brand_story: number
  product_crave_or_hero: number
  promotional: number
  occasion: number
  conversion: number
  loyalty_or_proof: number
  discovery_or_renewal: number
  engagement_or_behind_the_scenes: number
}

export const INTENT_CHAIN_MIX: Record<IntentState, ChainMix> = {
  launch: {
    brand_story: 30, product_crave_or_hero: 35, promotional: 0,
    occasion: 0, conversion: 10, loyalty_or_proof: 0,
    discovery_or_renewal: 15, engagement_or_behind_the_scenes: 10,
  },
  grow: {
    brand_story: 25, product_crave_or_hero: 40, promotional: 15,
    occasion: 15, conversion: 0, loyalty_or_proof: 0,
    discovery_or_renewal: 5, engagement_or_behind_the_scenes: 0,
  },
  defend: {
    brand_story: 30, product_crave_or_hero: 20, promotional: 0,
    occasion: 15, conversion: 10, loyalty_or_proof: 25,
    discovery_or_renewal: 0, engagement_or_behind_the_scenes: 0,
  },
  harvest: {
    brand_story: 0, product_crave_or_hero: 40, promotional: 20,
    occasion: 10, conversion: 25, loyalty_or_proof: 5,
    discovery_or_renewal: 0, engagement_or_behind_the_scenes: 0,
  },
  recover: {
    brand_story: 35, product_crave_or_hero: 0, promotional: 0,
    occasion: 10, conversion: 0, loyalty_or_proof: 25,
    discovery_or_renewal: 10, engagement_or_behind_the_scenes: 20,
  },
}

// Module-load self-test — loud failure beats silent drift.
for (const [intent, mix] of Object.entries(INTENT_CHAIN_MIX)) {
  const sum = Object.values(mix).reduce((a, b) => a + b, 0)
  if (sum !== 100) {
    throw new Error(`INTENT_CHAIN_MIX[${intent}] sums to ${sum}, expected 100`)
  }
}

export const INTENT_LABELS: Record<IntentState, { en: string; ar: string; question: string }> = {
  launch: {
    en: 'Launch',
    ar: 'الإطلاق',
    question: 'Establish that you exist and matter',
  },
  grow: {
    en: 'Grow',
    ar: 'النمو',
    question: 'Expand reach beyond current audience',
  },
  defend: {
    en: 'Defend',
    ar: 'الدفاع',
    question: 'Protect position from competitive pressure',
  },
  harvest: {
    en: 'Harvest',
    ar: 'الحصاد',
    question: 'Convert engaged audience into revenue',
  },
  recover: {
    en: 'Recover',
    ar: 'التعافي',
    question: 'Re-engage after dormancy or crisis',
  },
}
