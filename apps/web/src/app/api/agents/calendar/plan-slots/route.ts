/**
 * POST /api/agents/calendar/plan-slots
 *
 * Deterministic calendar slot planner (Doc §5.1-5.2, §9.5-9.6) — NO LLM.
 * Called by N8N-A01 AFTER CEO classify and BEFORE COO/DeepSeek. For each of the
 * N slots it assigns:
 *   - content_type  (largest-remainder allocation from the brand's content mix)
 *   - format        (image | video — at most VIDEO_CAP=2 video slots per calendar)
 *   - chain_id      (top-1 from the §9.5 scoring algorithm)
 *   - top_chains    (top-3 scored chains with breakdown — for Prompt Composer)
 *   - chain_family
 *
 * §9.5 full scoring is now live: style-register match (0-30) + brand approval
 * rate (0-40) + platform-wide approval rate (0-30) + occasion boost (+20).
 * No LLM is involved. CEO still routes first (Hard Rule #1 intact).
 *
 * Hard Rule #1 intact: CEO still routes first; this is deterministic Spine logic.
 */
import { adminClient, chainsQ, calendarsQ } from '@repo/db'
import { z } from 'zod'
import { schemas } from '@repo/core'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toChainQualityTier(brand: { pipeline_tier?: string | null; tier?: string | null } | null): string {
  if (brand?.pipeline_tier === 'Pro') return 'enterprise'
  if (brand?.tier === 'paid_starter') return 'growth'
  return 'starter'
}

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    post_count: z.number().int().min(1).max(40).default(20),
    schedule_dates: z
      .array(z.object({ date: z.string(), posting_time: z.string().optional(), hour: z.number().optional() }))
      .optional()
      .default([]),
    occasion_flags: z.array(z.string()).optional().default([]),
    // Optional brand-mix override; otherwise loaded from BrandDNA / sector baseline.
    content_mix: z.record(z.number()).optional(),
    // Optional: when present, intent_override on this calendar beats brand.intent_state.
    calendar_id: z.string().uuid().optional(),
  }),
})

// Slot shape extended with top-3 chain alternatives for the Prompt Composer.
type SlotWithTopChains = {
  slot_index: number
  posting_date: string
  posting_time: string | undefined
  content_type: string
  format: 'image' | 'video'
  chain_id: string | null
  chain_family: string | null
  rationale: string
  top_chains: Array<{
    chain_id: string
    family: string
    score: number
    score_breakdown: {
      occasion_boost: number
      style_match: number
      brand_approval: number
      platform_approval: number
      intent_boost: number
    }
  }>
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input): Promise<schemas.CalendarPlan & { slots_with_top_chains: SlotWithTopChains[] }> => {
    const db = adminClient()
    const { post_count, schedule_dates, occasion_flags, calendar_id } = input.payload

    // Load brand mix + tier + maturity + style_register + primary_channel + the
    // GROWTH DNA the chain scorer needs: intent_state (launch/grow/defend/harvest/
    // recover) drives which chain INTENTS to favour (Chain Library §"INTENT STATES"),
    // occasions_ranked + archetype + price_position shape occasion/style affinity.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await (db as any)
      .from('brand_profiles')
      .select('sector, pipeline_tier, tier, content_mix_ratios, created_at, religious_sensitivity, primary_channel, intent_state, archetype_primary, price_position, occasions_ranked, brand_differentiator, tone_register')
      .eq('brand_id', input.brand_id)
      .maybeSingle()

    // Load style_register from visual_style_profiles (separate table, added by migration 0086)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visualProfile } = await (db as any)
      .from('visual_style_profiles')
      .select('style_register')
      .eq('brand_id', input.brand_id)
      .maybeSingle()

    const sector: string = brand?.sector ?? 'general'
    const quality_tier = toChainQualityTier(brand)
    const is_starter = quality_tier === 'starter'
    const is_conservative = brand?.religious_sensitivity === 'High' || brand?.religious_sensitivity === 'Medium'
    const maturity_days = brand?.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(brand.created_at).getTime()) / MS_PER_DAY))
      : 365
    // style_register drives the +30 style_match boost in chain scoring (chain.style_affinity
    // === brand style → +30). Primary source is visual_style_profiles (migration 0086), but
    // that table is often empty. FALLBACK to brand_profiles.tone_register so the boost actually
    // fires for brands that completed onboarding (which sets tone_register, e.g. "Modern").
    // MUST lowercase: chains.style_affinity is lowercase ('modern'); tone_register is title-case.
    const _vspStyle = (visualProfile as { style_register?: string | null } | null)?.style_register ?? null
    const _toneStyle = (brand?.tone_register as string | null) ?? null
    const style_register: string | null = (_vspStyle || _toneStyle)
      ? String(_vspStyle || _toneStyle).trim().toLowerCase()
      : null
    const primary_channel: string | null = brand?.primary_channel ?? null

    // Mix priority: caller override -> brand content_mix_ratios -> sector baseline -> neutral.
    const nonEmpty = (m: Record<string, number> | null | undefined) =>
      m && Object.keys(m).length > 0 ? m : null
    let rawMix: Record<string, number> | null =
      nonEmpty(input.payload.content_mix) ?? nonEmpty(brand?.content_mix_ratios) ?? null
    if (!rawMix) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: baseline } = await (db as any)
        .from('sector_baselines')
        .select('recommended_content_mix')
        .eq('sector', sector)
        .limit(1)
        .maybeSingle()
      rawMix = nonEmpty(baseline?.recommended_content_mix as Record<string, number> | undefined)
    }

    const mix = schemas.coerceMix(rawMix)
    const contentTypes = schemas.allocateContentTypes(mix, post_count)

    // Occasion (normalized)
    let occasionFamily: string | null = null
    for (const flag of occasion_flags) {
      const fam = schemas.normalizeOccasion(flag)
      if (fam) { occasionFamily = fam; break }
    }

    // Effective intent: calendar-level override beats brand default.
    // Fetch the override only when a calendar_id was supplied (n8n passes it; direct
    // API calls without calendar_id fall back to brand.intent_state as before).
    const calendarIntentOverride = calendar_id
      ? await calendarsQ.getCalendarIntentOverride(calendar_id)
      : null
    const intent_state: string | null =
      calendarIntentOverride ?? (brand?.intent_state as string | null) ?? null
    const price_position: string | null = (brand?.price_position as string | null) ?? null
    const archetype: string | null = (brand?.archetype_primary as string | null) ?? null

    // Shared context for chain selection
    const chainCtx = {
      sector: schemas.sectorToChainToken(sector),
      occasionFamily,
      quality_tier,
      maturity_days,
      is_starter,
      is_conservative,
      style_register,
      primary_channel,
      brand_id: input.brand_id,
      // Growth DNA — used as soft boosts in scoring (does NOT hard-filter chains).
      intent_state,
      price_position,
      archetype,
    }

    // Resolve brand tier for video-frequency rules (free/pro).
    // Pro = pipeline_tier 'Pro'; free = explicit 'free' tier; anything else = standard.
    const brandTierRaw: string | null = brand?.pipeline_tier === 'Pro'
      ? 'pro'
      : brand?.tier === 'free'
        ? 'free'
        : null

    // Video chains are queried when an occasion is active OR when tier rules may
    // force video slots (free: 1 in first 8, pro: 3 in calendar).
    const needVideoChainQuery =
      occasionFamily != null || brandTierRaw === 'free' || brandTierRaw === 'pro'

    // Pull a WIDE pool (top-12) of scored chains so per-post content_type mapping has
    // real variety to choose from — instead of slamming every post onto the single
    // top-scorer (which made all 20 posts use F02). Doc design: a calendar uses many
    // purpose-specific chains (F01 hot-food, F02 beverage, U02 offer, U04 social-proof…).
    const [imageScoredChains, videoScoredChains] = await Promise.all([
      chainsQ.selectChainsForSlot({ ...chainCtx, output_type: 'image', topN: 12 }),
      needVideoChainQuery
        ? chainsQ.selectChainsForSlot({ ...chainCtx, output_type: 'video', topN: 6 })
        : Promise.resolve([]),
    ])

    const imageChain = imageScoredChains[0]?.chain ?? null
    const videoChain = videoScoredChains[0]?.chain ?? null

    // ── PER-POST CHAIN PICKER (content_type → chain purpose) ────────────────────
    // Match each post's content_type to the best-scoring chain whose name/purpose fits
    // that intent, rotating so the same chain isn't reused back-to-back. Keeps the
    // §9.5 score as the primary signal (the pool is already score-ranked) but adds the
    // doc's content_type→chain diversity. Falls back to the top chain if no keyword hit.
    const CT_KEYWORDS: Record<string, RegExp> = {
      offer:        /(offer|promo|price|menu|deal|card|cta|launch)/i,
      announcement: /(launch|reveal|new|arrival|announc|occasion|cta)/i,
      testimonial:  /(social[ _-]?proof|review|testimonial|ugc|authentic)/i,
      educational:  /(behind|bts|process|texture|macro|how|story|context)/i,
      lifestyle:    /(lifestyle|cafe|terrace|table|context|scene|spread|friends|family|outdoor)/i,
      emotional:    /(hero|food|hot|warm|family|mother|heritage|morning|spread)/i,
    }
    const usageCount = new Map<string, number>() // per-chain cap tracker (soft round-robin)
    function pickChainForPost(content_type: string, pool: typeof imageScoredChains) {
      if (!pool.length) return null
      const re = CT_KEYWORDS[content_type]
      // candidates whose name/purpose matches this content_type, in score order
      const matches = re
        ? pool.filter((s) => re.test(`${s.chain.name_en ?? ''} ${s.chain.purpose ?? ''} ${s.chain.family ?? ''}`))
        : []
      const ranked = matches.length ? matches : pool   // fall back to full pool
      // among the matching/ranked chains, prefer the LEAST-used so a calendar spreads
      // across several chains instead of repeating the single top one.
      let best = ranked[0], bestUse = Infinity
      for (const s of ranked) {
        const u = usageCount.get(s.chain.chain_id) ?? 0
        if (u < bestUse) { bestUse = u; best = s }
      }
      usageCount.set(best.chain.chain_id, (usageCount.get(best.chain.chain_id) ?? 0) + 1)
      return best.chain
    }

    // videoCap: pro tier needs up to 3; free and standard need at most 2 (VIDEO_CAP default).
    const videoCap = brandTierRaw === 'pro' ? 3 : schemas.VIDEO_CAP

    const videoSlots = new Set(
      schemas.pickVideoSlots(contentTypes, {
        occasionActive: occasionFamily != null,
        hasVideoChain: videoChain != null,
        tier: brandTierRaw,
        videoCap,
      }),
    )

    // Assemble per-slot plan — both the CalendarPlan-shaped slots and the
    // extended slots_with_top_chains that carry the top-3 for the Prompt Composer.
    const slots: schemas.CalendarPlan['slots'] = []
    const slots_with_top_chains: SlotWithTopChains[] = []

    contentTypes.forEach((content_type, i) => {
      const isVideo = videoSlots.has(i)
      // Per-post chain by content_type (image) / top video chain (video). This replaces
      // the old "imageChain for every post" that collapsed all posts onto F02.
      const chain   = isVideo ? videoChain : pickChainForPost(content_type, imageScoredChains)
      const scored  = isVideo ? videoScoredChains : imageScoredChains
      const sched   = schedule_dates[i]

      const base = {
        slot_index:   i,
        posting_date: sched?.date ?? '',
        posting_time: sched?.posting_time,
        content_type,
        format: isVideo ? ('video' as const) : ('image' as const),
        chain_id:     chain?.chain_id ?? null,
        chain_family: chain?.family   ?? null,
        rationale:    isVideo
          ? `video (${occasionFamily ?? 'occasion'} highlight)`
          : `image / ${content_type}`,
      }

      slots.push(base)
      slots_with_top_chains.push({
        ...base,
        top_chains: scored.map((s) => ({
          chain_id:       s.chain.chain_id,
          family:         s.chain.family,
          score:          s.score,
          score_breakdown: s.score_breakdown,
        })),
      })
    })

    const calendarPlan = schemas.CalendarPlan.parse({
      brand_id: input.brand_id,
      occasion: occasionFamily,
      slots,
    })

    return { ...calendarPlan, slots_with_top_chains }
  },
})
