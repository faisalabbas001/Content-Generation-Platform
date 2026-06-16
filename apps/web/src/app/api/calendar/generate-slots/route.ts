/**
 * POST /api/calendar/generate-slots
 *
 * Calendar Engine — rolling slot generator (spec §5, Phase 0 Spine-05).
 * Generates calendar_posts rows for a 3-month rolling window based on:
 *   - Brand content mix ratios
 *   - Platform weights
 *   - Saudi occasion schedule (frequency boosts + register shifts)
 *   - Occasion approach per brand (full / reduced / skip)
 *
 * Called by N8N-A01 after strategy approval and monthly by N8N-A05.
 * Idempotent: skips (brand_id, scheduled_date, channel) combos that already
 * exist to avoid duplicates.
 *
 * Requires migration 0092 to have run (scheduled_date, channel, format,
 * chain_id, requires_human_review, strategic_rationale, occasion_flags).
 */
import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    month_start:  z.string().regex(/^\d{4}-\d{2}$/),
    months_ahead: z.number().int().min(1).max(3).default(3),
  }),
})

// ── Constants (spec §5) ───────────────────────────────────────────────────────

/** Baseline posts per week for SME tier. */
const BASE_POSTS_PER_WEEK = 5

/** Max occasion-boosted posts on a single day (caps runaway multipliers). */
const MAX_POSTS_PER_DAY = 3

/**
 * Preferred posting days per content type.
 * Day numbers follow JS Date.getDay(): 0=Sun … 6=Sat.
 * Saudi work week is Sun-Thu; Fri-Sat is weekend.
 */
const CONTENT_TYPE_PREFERRED_DAYS: Record<string, number[]> = {
  educational:   [0, 1, 2, 3, 4],
  product_hero:  [0, 1, 2, 3, 4],
  lifestyle:     [0, 2, 4, 5, 6],
  behind_brand:  [1, 3],
  testimonial:   [0, 2, 4],
  community:     [5, 6],
  promotional:   [0, 1, 2, 3, 4],
  occasion:      [0, 1, 2, 3, 4, 5, 6],
}

/** Default format per platform — first in list is the primary slot. */
const PLATFORM_FORMATS: Record<string, string[]> = {
  Instagram: ['reel', 'feed', 'story'],
  TikTok:    ['video'],
  Snapchat:  ['story', 'spotlight'],
  Twitter:   ['tweet'],
}

/** Religious occasion keys that always require human review (spec §12.1). */
const RELIGIOUS_OCCASION_KEYS = new Set([
  'eid_al_fitr',
  'eid_al_adha',
  'hajj',
  'mawlid',
  'ramadan',
  'laylat_al_qadr',
  'isra_wal_miraj',
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]!
}

/**
 * Build a content-type repeating sequence proportional to the brand's mix
 * ratios, targeting BASE_POSTS_PER_WEEK total slots.
 */
function buildContentSequence(
  contentMix: Record<string, number>,
): string[] {
  const total = Object.values(contentMix).reduce((s, v) => s + v, 0) || 100
  const sequence: string[] = []

  for (const [type, pct] of Object.entries(contentMix)) {
    const count = Math.max(1, Math.round((pct / total) * BASE_POSTS_PER_WEEK))
    for (let i = 0; i < count; i++) sequence.push(type)
  }

  // Normalise to exactly BASE_POSTS_PER_WEEK
  while (sequence.length < BASE_POSTS_PER_WEEK) {
    sequence.push(sequence[0] ?? 'educational')
  }

  return sequence.slice(0, BASE_POSTS_PER_WEEK)
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',

  handler: async (input, _ctx) => {
    const db = adminClient()
    const { month_start, months_ahead } = input.payload

    // ── 1. Load brand strategy ──────────────────────────────────────────────
    const { data: brand, error: brandErr } = await db
      .from('brand_profiles')
      .select(`
        content_mix_ratios,
        platform_weights,
        occasion_approach,
        archetype_primary,
        lifecycle_stage,
        religious_sensitivity,
        sector
      `)
      .eq('brand_id', input.brand_id)
      .maybeSingle()

    if (brandErr || !brand) {
      throw new Error(`Brand ${input.brand_id} not found: ${brandErr?.message ?? 'no row'}`)
    }

    const contentMix = (brand.content_mix_ratios as Record<string, number> | null)
      ?? { educational: 30, product_hero: 30, lifestyle: 25, behind_brand: 15 }

    const platformWeights = (brand.platform_weights as Record<string, number> | null)
      ?? { Instagram: 60, TikTok: 25, Snapchat: 15 }

    // occasion_approach: { [occasion_key]: 'full' | 'reduced' | 'skip' }
    const occasionApproach = (brand.occasion_approach as Record<string, string> | null) ?? {}

    // Religious sensitivity HIGH means all occasion content needs review
    const highReligiousSensitivity =
      (brand.religious_sensitivity as string | null) === 'High'

    // ── 2. Compute date range ───────────────────────────────────────────────
    const [yearStr, monthStr] = month_start.split('-')
    const year  = parseInt(yearStr!,  10)
    const month = parseInt(monthStr!, 10)

    const startDate = new Date(year, month - 1, 1)
    const endDate   = new Date(year, month - 1 + months_ahead, 0) // last day of last month

    const rangeStart = toDateStr(startDate)
    const rangeEnd   = toDateStr(endDate)

    // ── 3. Load existing posts (dedup guard) ────────────────────────────────
    const { data: existingPostsRaw } = await db
      .from('calendar_posts')
      .select('scheduled_date, channel' as never)
      .eq('brand_id', input.brand_id)
      .gte('scheduled_date' as never, rangeStart)
      .lte('scheduled_date' as never, rangeEnd)
    const existingPosts = existingPostsRaw as unknown as Array<{ scheduled_date: string; channel: string }> | null

    const existingSet = new Set<string>(
      (existingPosts ?? []).map((p) => {
        return `${p.scheduled_date}:${p.channel}`
      }),
    )

    // ── 4. Load Saudi occasions for the period ──────────────────────────────
    const { data: occasionRowsRaw } = await db
      .from('occasion_intelligence')
      .select('occasion_key, gregorian_date, lead_weeks, frequency_boost, register_shift' as never)
      .gte('gregorian_date' as never, rangeStart)
      .lte('gregorian_date' as never, rangeEnd)
    const occasionRows = occasionRowsRaw as unknown as Array<{
      occasion_key: string
      gregorian_date: string
      lead_weeks: number | null
      frequency_boost: number | null
      register_shift: string | null
    }> | null

    /**
     * occasionMap: date string → { boost, register, keys }
     * Uses lead_weeks to spread occasion awareness back from the occasion date.
     */
    const occasionMap: Record<string, { boost: number; register: string; keys: string[] }> = {}

    for (const o of occasionRows ?? []) {
      const occasionDate = new Date(o.gregorian_date)
      const leadWeeks    = o.lead_weeks ?? 1
      const leadStart    = addDays(occasionDate, -(leadWeeks * 7))

      // Mark all days in [leadStart, occasionDate] as occasion-aware
      for (
        let d = new Date(Math.max(leadStart.getTime(), startDate.getTime()));
        d <= occasionDate && d <= endDate;
        d = addDays(d, 1)
      ) {
        const ds = toDateStr(d)
        if (!occasionMap[ds]) {
          occasionMap[ds] = { boost: 1, register: 'standard', keys: [] }
        }
        const boost = o.frequency_boost ?? 1
        occasionMap[ds].boost    = Math.max(occasionMap[ds].boost, boost)
        occasionMap[ds].register = o.register_shift ?? occasionMap[ds].register
        if (!occasionMap[ds].keys.includes(o.occasion_key)) {
          occasionMap[ds].keys.push(o.occasion_key)
        }
      }
    }

    // ── 5. Build ordered platform list (descending weight) ─────────────────
    const platforms = Object.entries(platformWeights)
      .sort(([, a], [, b]) => b - a)
      .map(([p]) => p)
    const primaryPlatform = platforms[0] ?? 'Instagram'

    // ── 6. Build content-type weekly sequence ───────────────────────────────
    const contentSequence = buildContentSequence(contentMix)

    // ── 7. Ensure calendars rows exist (one per brand+month in range) ───────
    //      calendar_posts.calendar_id is NOT NULL, so we need FK rows.
    const monthsInRange: string[] = []
    for (let m = 0; m < months_ahead; m++) {
      const d = new Date(year, month - 1 + m, 1)
      monthsInRange.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const calendarIdByMonth: Record<string, string> = {}

    for (const mon of monthsInRange) {
      // Upsert so this is idempotent
      const { data: calRow, error: calErr } = await db
        .from('calendars')
        .upsert(
          { brand_id: input.brand_id, month: mon, status: 'draft' },
          { onConflict: 'brand_id,month', ignoreDuplicates: false },
        )
        .select('calendar_id')
        .maybeSingle()

      if (calErr || !calRow) {
        // Fall back to a plain select if upsert returned nothing
        const { data: existing } = await db
          .from('calendars')
          .select('calendar_id')
          .eq('brand_id', input.brand_id)
          .eq('month', mon)
          .maybeSingle()
        if (!existing) throw new Error(`Failed to ensure calendars row for ${mon}: ${calErr?.message}`)
        calendarIdByMonth[mon] = (existing as { calendar_id: string }).calendar_id
      } else {
        calendarIdByMonth[mon] = (calRow as { calendar_id: string }).calendar_id
      }
    }

    // ── 8. Generate slot rows ───────────────────────────────────────────────
    type SlotRow = {
      calendar_id:           string
      brand_id:              string
      scheduled_date:        string
      channel:               string
      format:                string
      content_type:          string
      status:                string
      ai_generated:          boolean
      c2pa_signed:           boolean
      requires_human_review: boolean
      strategic_rationale:   string
      occasion_flags:        string[]
      watermark:             boolean
      position:              number
      hashtags:              string[]
    }

    const slotsToInsert: SlotRow[] = []
    let weekContentIdx = 0
    let currentDate    = new Date(startDate)

    // Track position within each (calendar_id, channel) to satisfy UNIQUE(calendar_id, position)
    // Since position is per calendar (not per channel), we track per calendar_id
    const positionByCalendar: Record<string, number> = {}

    while (currentDate <= endDate) {
      const ds            = toDateStr(currentDate)
      const dow           = currentDate.getDay() // 0=Sun…6=Sat
      const occasionToday = occasionMap[ds]

      // Number of posts to schedule today:
      //   - Base: 1 post/day on weekdays (Sun-Thu), 0 on weekends unless occasion
      //   - Boosted days: multiply by frequency_boost, capped at MAX_POSTS_PER_DAY
      const isWeekend = dow === 5 || dow === 6
      const baseCount = isWeekend ? 0 : 1

      let dayPostCount: number
      if (occasionToday) {
        dayPostCount = Math.min(
          MAX_POSTS_PER_DAY,
          Math.max(1, Math.round(Math.max(baseCount, 1) * occasionToday.boost)),
        )
      } else {
        dayPostCount = baseCount
      }

      for (let slotIdx = 0; slotIdx < dayPostCount; slotIdx++) {
        // Determine content type
        let contentType = contentSequence[weekContentIdx % contentSequence.length]!
        weekContentIdx++

        let occasionKeys: string[] = []

        if (occasionToday && slotIdx === 0) {
          occasionKeys = occasionToday.keys

          // Check brand's occasion approach for the primary occasion
          const primaryOccasion = occasionKeys[0]!
          const approach = occasionApproach[primaryOccasion] ?? 'full'

          if (approach === 'skip') {
            // Skip the entire day for this occasion
            break
          }
          if (approach === 'reduced' && slotIdx > 0) {
            // Reduced: only one post on occasion days
            break
          }

          contentType = 'occasion'
        }

        // Check preferred days for this content type
        const preferred = CONTENT_TYPE_PREFERRED_DAYS[contentType] ?? [0, 1, 2, 3, 4]
        if (!preferred.includes(dow)) {
          // Not a preferred day — skip this slot
          weekContentIdx-- // don't advance the sequence counter
          continue
        }

        // Assign platform (rotate through by weight)
        const platform = platforms[slotIdx % platforms.length] ?? primaryPlatform
        const format   = PLATFORM_FORMATS[platform]?.[0] ?? 'feed'

        // Dedup check: skip if (date, channel) already exists
        const slotKey = `${ds}:${platform}`
        if (existingSet.has(slotKey)) continue
        existingSet.add(slotKey)

        // Religious content → requires_human_review (spec §12.1)
        const requiresHumanReview =
          highReligiousSensitivity ||
          occasionKeys.some((k) => RELIGIOUS_OCCASION_KEYS.has(k))

        // Strategic rationale string
        const rationale = occasionToday && occasionKeys.length > 0
          ? `Occasion: ${occasionKeys.join(', ')} — ${occasionToday.register} register. Content type: ${contentType}.`
          : `Scheduled ${contentType} content for ${platform}. Archetype: ${(brand.archetype_primary as string | null) ?? 'unknown'}.`

        // Resolve calendar_id for this date's month
        const postMonth = ds.slice(0, 7)
        const calId     = calendarIdByMonth[postMonth]
        if (!calId) continue // safety — should never happen

        // Assign position within calendar (unique per calendar)
        const pos = (positionByCalendar[calId] ?? 0) + 1
        positionByCalendar[calId] = pos

        slotsToInsert.push({
          calendar_id:           calId,
          brand_id:              input.brand_id,
          scheduled_date:        ds,
          channel:               platform,
          format,
          content_type:          contentType,
          status:                'pending',
          ai_generated:          true,
          c2pa_signed:           false,
          requires_human_review: requiresHumanReview,
          strategic_rationale:   rationale,
          occasion_flags:        occasionKeys,
          watermark:             true,
          position:              pos,
          hashtags:              [],
        })
      }

      currentDate = addDays(currentDate, 1)
    }

    // ── 9. Batch insert ─────────────────────────────────────────────────────
    let inserted = 0
    const BATCH_SIZE = 50

    for (let i = 0; i < slotsToInsert.length; i += BATCH_SIZE) {
      const batch = slotsToInsert.slice(i, i + BATCH_SIZE)
      const { error: insertErr } = await db
        .from('calendar_posts')
        .insert(batch as never)

      if (insertErr) {
        console.warn(
          `[calendar/generate-slots] batch insert failed (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${insertErr.message}`,
        )
      } else {
        inserted += batch.length
      }
    }

    const skipped    = slotsToInsert.length - inserted
    const allOccKeys = [...new Set(slotsToInsert.flatMap((s) => s.occasion_flags))]

    return {
      task_type:               'calendar_slots_generated' as const,
      brand_id:                input.brand_id,
      range_start:             rangeStart,
      range_end:               rangeEnd,
      months_covered:          months_ahead,
      slots_generated:         inserted,
      slots_skipped_existing:  skipped,
      occasions_incorporated:  allOccKeys,
      primary_platform:        primaryPlatform,
    }
  },
})
