/**
 * Calendar slot planner — deterministic, no-LLM contract (Doc §5.1-5.2, §9.5-9.6).
 *
 * Each of the N calendar slots independently gets:
 *   - a content_type (allocated from the brand's content mix)
 *   - a format (image | video) — at most VIDEO_CAP video slots per calendar
 *   - a chain (selected deterministically downstream by selectChainForSlot)
 *
 * This module is PURE (no IO): Zod schemas + vocabulary maps + the largest-remainder
 * content-type allocator + the video-slot ranking rule. The route layer
 * (`/api/agents/calendar/plan-slots`) does the DB reads and calls these helpers.
 *
 * Vocabulary note (verified against seed data):
 *   - sector_baselines.recommended_content_mix already speaks the DeepSeek
 *     ContentType vocabulary (emotional/lifestyle/offer), so content-type mapping
 *     is an alias *coercion*, not a full remap.
 *   - Occasion keys differ across the n8n month-map (ramadan_2026, eid_al_fitr_2026),
 *     the occasions table (ramadan, eid_fitr, national_day) and chains.eligible_occasions
 *     (ramadan, eid, eid_al_fitr, national_day). normalizeOccasion() collapses all of
 *     these to a coarse canonical family so the occasion boost/filter actually fires.
 */
import { z } from 'zod'
import { ContentType } from './deepseek'

export const PostFormat = z.enum(['image', 'video'])
export type PostFormat = z.infer<typeof PostFormat>

export const SlotPlan = z.object({
  slot_index: z.number().int().min(0),
  posting_date: z.string(), // "YYYY-MM-DD"
  posting_time: z.string().optional(),
  content_type: ContentType,
  format: PostFormat,
  chain_id: z.string().nullable(),
  chain_family: z.string().nullable(),
  rationale: z.string().optional(),
})
export type SlotPlan = z.infer<typeof SlotPlan>

export const CalendarPlan = z.object({
  brand_id: z.string(),
  month: z.string().optional(),
  occasion: z.string().nullable(), // canonical occasion family, or null
  slots: z.array(SlotPlan),
})
export type CalendarPlan = z.infer<typeof CalendarPlan>

// ── Content-type vocabulary ──────────────────────────────────────────────────
// Canonical order — used for deterministic tie-breaking in allocation.
export const CONTENT_TYPE_ORDER = [
  'emotional',
  'lifestyle',
  'offer',
  'educational',
  'testimonial',
  'announcement',
] as const
export type ContentTypeValue = (typeof CONTENT_TYPE_ORDER)[number]

/** Coerce arbitrary content-mix keys (brand or doc vocabulary) to the DeepSeek enum. */
const CONTENT_TYPE_ALIAS: Record<string, ContentTypeValue> = {
  emotional: 'emotional',
  lifestyle: 'lifestyle',
  offer: 'offer',
  educational: 'educational',
  testimonial: 'testimonial',
  announcement: 'announcement',
  // Doc §5.2 / brand vocabulary → DeepSeek enum
  product: 'offer',
  occasion: 'emotional',
  brand_story: 'emotional',
  behind_the_scenes: 'educational',
  bts: 'educational',
  behind_scenes: 'educational',
  founder: 'testimonial',
  campaign: 'announcement',
  transformation: 'lifestyle',
  milestone: 'announcement',
  education: 'educational',
  trust: 'testimonial',
  property: 'offer',
}

/** Neutral fallback mix when neither brand ratios nor sector baseline exist. Sums to 1. */
export const NEUTRAL_MIX: Record<ContentTypeValue, number> = {
  emotional: 0.3,
  lifestyle: 0.3,
  offer: 0.2,
  educational: 0.1,
  testimonial: 0.05,
  announcement: 0.05,
}

/**
 * Coerce a raw mix (arbitrary keys, weights may be 0-1 or 0-100) into a normalized
 * Record over the canonical ContentType vocabulary summing to 1. Returns NEUTRAL_MIX
 * if the input is empty/unusable.
 */
export function coerceMix(raw: Record<string, number> | null | undefined): Record<ContentTypeValue, number> {
  const acc: Partial<Record<ContentTypeValue, number>> = {}
  let total = 0
  for (const [k, v] of Object.entries(raw ?? {})) {
    const canon = CONTENT_TYPE_ALIAS[k.trim().toLowerCase()]
    const weight = typeof v === 'number' && v > 0 ? v : 0
    if (!canon || weight <= 0) continue
    acc[canon] = (acc[canon] ?? 0) + weight
    total += weight
  }
  if (total <= 0) return { ...NEUTRAL_MIX }
  const out = {} as Record<ContentTypeValue, number>
  for (const t of CONTENT_TYPE_ORDER) out[t] = (acc[t] ?? 0) / total
  return out
}

/**
 * Largest-remainder allocation of `postCount` slots across content types per `mix`,
 * then spread evenly (not blocked) so types interleave across the calendar.
 * Deterministic: ties broken by CONTENT_TYPE_ORDER. Always returns exactly postCount items.
 */
export function allocateContentTypes(
  mix: Record<ContentTypeValue, number>,
  postCount: number,
): ContentTypeValue[] {
  if (postCount <= 0) return []
  // 1. Largest-remainder counts.
  const raw = CONTENT_TYPE_ORDER.map((t) => ({ t, exact: (mix[t] ?? 0) * postCount }))
  const counts: Record<ContentTypeValue, number> = {} as Record<ContentTypeValue, number>
  let assigned = 0
  for (const r of raw) {
    counts[r.t] = Math.floor(r.exact)
    assigned += counts[r.t]
  }
  let remainder = postCount - assigned
  const byFrac = [...raw].sort((a, b) => {
    const fa = a.exact - Math.floor(a.exact)
    const fb = b.exact - Math.floor(b.exact)
    if (fb !== fa) return fb - fa
    return CONTENT_TYPE_ORDER.indexOf(a.t) - CONTENT_TYPE_ORDER.indexOf(b.t)
  })
  for (let i = 0; remainder > 0; i = (i + 1) % byFrac.length, remainder--) {
    counts[byFrac[i]!.t] += 1
  }
  // 2. Spread evenly across [0, postCount) via fractional positions.
  const entries: { pos: number; rank: number; t: ContentTypeValue }[] = []
  for (const t of CONTENT_TYPE_ORDER) {
    const c = counts[t]
    for (let k = 0; k < c; k++) {
      entries.push({ pos: (k + 0.5) / c, rank: CONTENT_TYPE_ORDER.indexOf(t), t })
    }
  }
  entries.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.rank - b.rank))
  return entries.map((e) => e.t)
}

// ── Sector vocabulary ────────────────────────────────────────────────────────
// brand_profiles.sector is an enum (F&B, Beauty_Wellness, Retail, …) but
// chains.eligible_sectors uses lowercase tokens (f_and_b, beauty, retail, …).
// Map the brand enum to the chain token so sector filtering actually matches.
const SECTOR_TO_CHAIN_TOKEN: Record<string, string> = {
  'f&b': 'f_and_b',
  'f_and_b': 'f_and_b',
  'beauty_wellness': 'beauty',
  'beauty': 'beauty',
  'retail': 'retail',
  'healthcare': 'healthcare',
  'finance': 'finance',
  'government': 'government',
  'real_estate': 'real_estate',
  'fitness': 'fitness',
  'home': 'home',
}

/** Map a brand sector enum value to the chains.eligible_sectors token vocabulary. */
export function sectorToChainToken(sector: string | null | undefined): string {
  if (!sector) return 'general'
  const key = sector.trim().toLowerCase()
  return SECTOR_TO_CHAIN_TOKEN[key] ?? key
}

// ── Occasion vocabulary ──────────────────────────────────────────────────────
/**
 * Collapse any occasion token (n8n month-map, occasions table, or chains seed)
 * to a coarse canonical family. Returns null for non-occasion tokens (summer, etc.)
 * so the planner treats them as "no active occasion".
 */
export function normalizeOccasion(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (s === 'none' || s === '') return null
  if (s.includes('ramadan')) return 'ramadan'
  if (s.includes('eid')) return 'eid' // coarse: covers eid_fitr / eid_adha / eid_al_*
  if (s.includes('national_day')) return 'national_day'
  if (s.includes('founding_day')) return 'founding_day'
  return null
}

/** True if a chain's eligible_occasions (raw seed tokens) covers the active family. */
export function occasionMatches(
  chainOccasions: string[] | null | undefined,
  activeFamily: string | null,
): boolean {
  if (!chainOccasions || chainOccasions.length === 0) return true // null = all occasions
  if (!activeFamily) return true
  return chainOccasions.some((o) => normalizeOccasion(o) === activeFamily)
}

// ── Video-slot ranking (Doc: cap 2 on highest-value slots) ──────────────────
export const VIDEO_CAP = 2

/**
 * Deterministically choose which slot indices become video.
 *
 * Base behaviour (occasion-gated):
 *   Returns [] when no occasion is active or no eligible video chain exists.
 *   slotA — occasion greeting: earliest announcement/emotional slot (else slot 0).
 *   slotB — launch/hero: offer slot nearest the calendar midpoint (else midpoint).
 *
 * Tier overrides (applied AFTER occasion-gated selection):
 *   - tier = 'free'     → guarantee at least 1 video in the first 8 slots, even without
 *                         an active occasion. Converts the best candidate in slots 0-7.
 *   - tier = 'pro'      → guarantee at least 3 videos in the full calendar, even without
 *                         an active occasion. Fills remaining slots with best candidates
 *                         (emotional/announcement first, then offer, then any).
 *
 * videoCap limits the total slots returned. Defaults to VIDEO_CAP (2) when omitted,
 * but callers may pass a higher cap when tier rules require more videos.
 */
export function pickVideoSlots(
  contentTypes: ContentTypeValue[],
  opts: {
    occasionActive: boolean
    hasVideoChain: boolean
    tier?: 'free' | 'pro' | string | null
    videoCap?: number
  },
): number[] {
  const n = contentTypes.length
  if (n === 0 || !opts.hasVideoChain) return []

  const cap = opts.videoCap ?? VIDEO_CAP

  // ── Occasion-gated core slots ──────────────────────────────────────────────
  const occasionSlots: number[] = []
  if (opts.occasionActive) {
    const slotA = (() => {
      const i = contentTypes.findIndex((t) => t === 'announcement' || t === 'emotional')
      return i >= 0 ? i : 0
    })()

    const mid = Math.floor(n / 2)
    const slotB = (() => {
      const offers = contentTypes.map((t, i) => ({ t, i })).filter((x) => x.t === 'offer')
      if (offers.length === 0) return mid
      offers.sort((a, b) => {
        const da = Math.abs(a.i - mid)
        const db = Math.abs(b.i - mid)
        return da !== db ? da - db : a.i - b.i
      })
      return offers[0]!.i
    })()

    for (const s of [slotA, slotB]) {
      if (!occasionSlots.includes(s)) occasionSlots.push(s)
      if (occasionSlots.length >= cap) break
    }
  }

  // ── Tier override: free — at least 1 video in first 8 slots ───────────────
  if (opts.tier === 'free') {
    const window = Math.min(8, n)
    const alreadyCovered = occasionSlots.some((s) => s < window)
    if (!alreadyCovered) {
      // Pick the best candidate in the first 8: announcement/emotional > offer > any
      const priority = ['announcement', 'emotional', 'offer'] as ContentTypeValue[]
      let pick = -1
      for (const type of priority) {
        const idx = contentTypes.slice(0, window).findIndex((t) => t === type)
        if (idx >= 0) { pick = idx; break }
      }
      if (pick < 0) pick = 0
      const merged = [...occasionSlots]
      if (!merged.includes(pick)) merged.unshift(pick)
      return merged.slice(0, Math.max(cap, 1))
    }
    return occasionSlots.slice(0, Math.max(cap, 1))
  }

  // ── Tier override: pro — at least 3 videos in the full calendar ───────────
  if (opts.tier === 'pro') {
    const minVideos = 3
    const result = [...occasionSlots]
    if (result.length < minVideos) {
      // Fill with best remaining candidates: emotional/announcement, then offer, then any
      const priority = ['announcement', 'emotional', 'offer'] as ContentTypeValue[]
      const candidates: number[] = []
      for (const type of priority) {
        contentTypes.forEach((t, i) => { if (t === type && !result.includes(i)) candidates.push(i) })
      }
      // Any remaining slots not yet added
      contentTypes.forEach((_, i) => { if (!result.includes(i) && !candidates.includes(i)) candidates.push(i) })
      for (const c of candidates) {
        if (result.length >= minVideos) break
        result.push(c)
      }
    }
    return result.slice(0, Math.max(cap, minVideos))
  }

  // ── Default: occasion-gated only ──────────────────────────────────────────
  return occasionSlots
}
