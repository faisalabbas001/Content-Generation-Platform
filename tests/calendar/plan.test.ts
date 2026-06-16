/**
 * Deterministic calendar slot planner — unit tests.
 *
 * Covers the pure helpers (vocab coercion, largest-remainder allocation,
 * occasion normalization, video-slot rule) and selectChainForSlot's
 * filter + scoring + tiebreak (DB mocked).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  coerceMix,
  allocateContentTypes,
  normalizeOccasion,
  occasionMatches,
  pickVideoSlots,
  sectorToChainToken,
  NEUTRAL_MIX,
  CONTENT_TYPE_ORDER,
} from '../../packages/core/src/schemas/calendar-plan'

// ── DB mock for selectChainForSlot ───────────────────────────────────────────
let MOCK_CHAINS: unknown[] = []
vi.mock('../../packages/db/src/client', () => {
  const builder: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq', 'lte', 'contains', 'order', 'maybeSingle']) {
    builder[m] = () => builder
  }
  // Awaitable: `await q` resolves to { data }.
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: MOCK_CHAINS })
  return {
    isDbConfigured: () => true,
    adminClient: () => builder,
  }
})
import { selectChainForSlot } from '../../packages/db/src/queries/chains'

afterEach(() => {
  MOCK_CHAINS = []
  vi.clearAllMocks()
})

function tally(arr: string[]): Record<string, number> {
  return arr.reduce((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {} as Record<string, number>)
}

describe('coerceMix', () => {
  it('keeps canonical keys and normalizes to sum 1', () => {
    const m = coerceMix({ emotional: 0.4, lifestyle: 0.35, offer: 0.25 })
    expect(m.emotional + m.lifestyle + m.offer).toBeCloseTo(1)
    expect(m.emotional).toBeCloseTo(0.4)
  })
  it('coerces brand/doc vocabulary aliases', () => {
    const m = coerceMix({ product: 30, lifestyle: 20, founder: 10 }) // → offer/lifestyle/testimonial
    expect(m.offer).toBeCloseTo(0.5)
    expect(m.lifestyle).toBeCloseTo(1 / 3)
    expect(m.testimonial).toBeCloseTo(1 / 6)
  })
  it('falls back to NEUTRAL_MIX on empty/unusable input', () => {
    expect(coerceMix(null)).toEqual(NEUTRAL_MIX)
    expect(coerceMix({ nonsense: 5 })).toEqual(NEUTRAL_MIX)
  })
})

describe('allocateContentTypes', () => {
  it('produces exactly post_count items honoring the ratios', () => {
    const out = allocateContentTypes(coerceMix({ emotional: 0.4, lifestyle: 0.35, offer: 0.25 }), 20)
    expect(out).toHaveLength(20)
    const t = tally(out)
    expect(t.emotional).toBe(8)
    expect(t.lifestyle).toBe(7)
    expect(t.offer).toBe(5)
  })
  it('sums to post_count for awkward counts (largest remainder)', () => {
    const out = allocateContentTypes(coerceMix({ emotional: 1, lifestyle: 1, offer: 1 }), 7)
    expect(out).toHaveLength(7)
    expect(Object.values(tally(out)).reduce((a, b) => a + b, 0)).toBe(7)
  })
  it('only emits canonical content types', () => {
    const out = allocateContentTypes(NEUTRAL_MIX, 12)
    for (const t of out) expect(CONTENT_TYPE_ORDER).toContain(t)
  })
  it('returns [] for post_count 0', () => {
    expect(allocateContentTypes(NEUTRAL_MIX, 0)).toEqual([])
  })
})

describe('sectorToChainToken', () => {
  it('maps brand sector enum to chain token vocabulary', () => {
    expect(sectorToChainToken('F&B')).toBe('f_and_b')
    expect(sectorToChainToken('Beauty_Wellness')).toBe('beauty')
    expect(sectorToChainToken('Retail')).toBe('retail')
  })
  it('passes through unknown sectors lowercased; null → general', () => {
    expect(sectorToChainToken('Healthcare')).toBe('healthcare')
    expect(sectorToChainToken(null)).toBe('general')
  })
})

describe('normalizeOccasion / occasionMatches', () => {
  it('collapses month-map keys to canonical families', () => {
    expect(normalizeOccasion('ramadan_2026')).toBe('ramadan')
    expect(normalizeOccasion('eid_al_fitr_2026')).toBe('eid')
    expect(normalizeOccasion('national_day')).toBe('national_day')
    expect(normalizeOccasion('summer_start')).toBeNull()
    expect(normalizeOccasion('none')).toBeNull()
    expect(normalizeOccasion(undefined)).toBeNull()
  })
  it('matches chains by normalized family (null = all occasions)', () => {
    expect(occasionMatches(null, 'ramadan')).toBe(true)
    expect(occasionMatches(['ramadan', 'ramadan_iftar'], 'ramadan')).toBe(true)
    expect(occasionMatches(['eid_al_fitr', 'eid_al_adha'], 'eid')).toBe(true)
    expect(occasionMatches(['national_day'], 'ramadan')).toBe(false)
    expect(occasionMatches(['ramadan'], null)).toBe(true)
  })
})

describe('pickVideoSlots', () => {
  const types = (() => {
    const a = Array(20).fill('lifestyle')
    a[0] = 'emotional'
    a[10] = 'offer'
    return a as never[]
  })()

  it('returns [] when occasion inactive', () => {
    expect(pickVideoSlots(types, { occasionActive: false, hasVideoChain: true })).toEqual([])
  })
  it('returns [] when no video chain', () => {
    expect(pickVideoSlots(types, { occasionActive: true, hasVideoChain: false })).toEqual([])
  })
  it('picks greeting (emotional@0) + hero (offer near midpoint)', () => {
    expect(pickVideoSlots(types, { occasionActive: true, hasVideoChain: true })).toEqual([0, 10])
  })
  it('never exceeds the cap of 2', () => {
    const v = pickVideoSlots(types, { occasionActive: true, hasVideoChain: true })
    expect(v.length).toBeLessThanOrEqual(2)
  })
  it('dedupes when greeting and hero collapse to one slot', () => {
    const all = Array(3).fill('emotional') as never[] // no offer → slotB = midpoint(1); slotA = 0
    const v = pickVideoSlots(all, { occasionActive: true, hasVideoChain: true })
    expect(new Set(v).size).toBe(v.length)
  })
})

describe('selectChainForSlot', () => {
  const base = {
    eligible_sectors: null,
    excluded_sectors: null,
    excluded_occasions: null,
    cultural_constraints: {},
    output_type: 'image',
    fal_model_secondary: null,
    prompt_template: 'x',
    family: 'TF01',
  }
  const ctx = {
    sector: 'F&B',
    occasionFamily: 'ramadan' as string | null,
    quality_tier: 'starter',
    maturity_days: 365,
    is_starter: true,
  }

  it('prefers an occasion-matched chain over a cheaper generic one (+20 boost)', async () => {
    MOCK_CHAINS = [
      { ...base, chain_id: 'A_generic', eligible_occasions: null, cost_estimate_usd: 1.0 },
      { ...base, chain_id: 'B_ramadan', eligible_occasions: ['ramadan'], cost_estimate_usd: 2.0 },
      { ...base, chain_id: 'C_natday', eligible_occasions: ['national_day'], cost_estimate_usd: 0.5 },
    ]
    const c = await selectChainForSlot({ ...ctx, output_type: 'image' })
    expect(c?.chain_id).toBe('B_ramadan') // wins on boost despite higher cost; C filtered out
  })

  it('falls back to cheapest when no occasion is active', async () => {
    MOCK_CHAINS = [
      { ...base, chain_id: 'A_generic', eligible_occasions: null, cost_estimate_usd: 1.0 },
      { ...base, chain_id: 'B_ramadan', eligible_occasions: ['ramadan'], cost_estimate_usd: 2.0 },
      { ...base, chain_id: 'C_cheap', eligible_occasions: null, cost_estimate_usd: 0.5 },
    ]
    const c = await selectChainForSlot({ ...ctx, occasionFamily: null, output_type: 'image' })
    expect(c?.chain_id).toBe('C_cheap')
  })

  it('excludes flagged chains for starter brands (cultural gate)', async () => {
    MOCK_CHAINS = [
      { ...base, chain_id: 'flagged', eligible_occasions: null, cost_estimate_usd: 0.1, cultural_constraints: { high_gender_sensitivity: true } },
      { ...base, chain_id: 'safe', eligible_occasions: null, cost_estimate_usd: 1.0 },
    ]
    const c = await selectChainForSlot({ ...ctx, output_type: 'image' })
    expect(c?.chain_id).toBe('safe')
  })

  it('video guard: rejects video chains missing fal_model_secondary/prompt_template', async () => {
    MOCK_CHAINS = [
      { ...base, chain_id: 'vid_bad', output_type: 'video', eligible_occasions: ['ramadan'], fal_model_secondary: null, prompt_template: 'x', cost_estimate_usd: 0.1 },
      { ...base, chain_id: 'vid_ok', output_type: 'video', eligible_occasions: ['ramadan'], fal_model_secondary: 'fal-ai/kling', prompt_template: 'x', cost_estimate_usd: 1.0 },
    ]
    const c = await selectChainForSlot({ ...ctx, output_type: 'video' })
    expect(c?.chain_id).toBe('vid_ok')
  })

  it('returns null when nothing is eligible', async () => {
    MOCK_CHAINS = [
      { ...base, chain_id: 'wrong_sector', eligible_sectors: ['Retail'], eligible_occasions: null, cost_estimate_usd: 0.1 },
    ]
    const c = await selectChainForSlot({ ...ctx, output_type: 'image' })
    expect(c).toBeNull()
  })
})
